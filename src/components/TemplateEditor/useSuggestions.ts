/**
 * @fileoverview Custom hook that encapsulates the suggestion dropdown logic
 * for TemplateEditor.
 *
 * Manages filter state, keyboard navigation (arrow keys, enter, escape),
 * positioning relative to the caret, and placeholder insertion.
 *
 * @module TemplateEditor/useSuggestions
 */

import { useState, useCallback, useMemo } from 'react';
import type { Placeholder } from './types';

/**
 * Return type of the {@link useSuggestions} hook.
 */
export interface SuggestionsState {
  /** Whether the suggestion dropdown is currently visible. */
  isOpen: boolean;
  /** Current filter text (the part after `{`). */
  filterText: string;
  /** Index of the currently highlighted suggestion. */
  activeIndex: number;
  /** CSS position {top, left} relative to the editor. */
  position: { top: number; left: number };

  /** Open the dropdown with a given filter and caret position. */
  open: (filter: string, caretRect: DOMRect, editorRect: DOMRect) => void;
  /** Close the dropdown and reset filter state. */
  close: () => void;
  /** Move highlight to the next suggestion (wraps around). */
  next: () => void;
  /** Move highlight to the previous suggestion (wraps around). */
  prev: () => void;
  /** Set highlight to a specific index (for mouse hover). */
  setIndex: (index: number) => void;
  /** Filtered list of placeholders matching the current filter text. */
  filtered: Placeholder[];
}

/**
 * Creates suggestion dropdown state and controls.
 *
 * @param placeholders - All available placeholder definitions.
 * @returns Suggestions state object.
 *
 * @example
 * ```ts
 * const suggestions = useSuggestions(placeholders);
 *
 * // On typing '{Us':
 * suggestions.open('Us', caretRect, editorRect);
 *
 * // On ArrowDown:
 * suggestions.next();
 *
 * // On Enter:
 * const selected = suggestions.filtered[suggestions.activeIndex];
 * insertPlaceholder(selected);
 * suggestions.close();
 * ```
 */
export function useSuggestions(placeholders: Placeholder[]): SuggestionsState {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const filtered = useMemo(() => {
    const f = filterText.toLowerCase();
    if (!f) return placeholders;
    return placeholders.filter(
      (ph) =>
        ph.id.toLowerCase().includes(f) || ph.label.toLowerCase().includes(f)
    );
  }, [filterText, placeholders]);

  const open = useCallback(
    (filter: string, caretRect: DOMRect, editorRect: DOMRect) => {
      setFilterText(filter);
      setActiveIndex(0);
      setPosition({
        top: caretRect.bottom - editorRect.top,
        left: caretRect.left - editorRect.left,
      });
      setIsOpen(true);
    },
    []
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setFilterText('');
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    setActiveIndex((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
  }, [filtered.length]);

  const prev = useCallback(() => {
    setActiveIndex((i) =>
      filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0
    );
  }, [filtered.length]);

  const setIndex = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  return {
    isOpen,
    filterText,
    activeIndex,
    position,
    open,
    close,
    next,
    prev,
    setIndex,
    filtered,
  };
}
