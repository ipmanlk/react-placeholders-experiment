/**
 * @fileoverview Main TemplateEditor component — a rich text editor with
 * non-editable placeholder chips, autocomplete suggestions, custom undo/redo,
 * and IME support.
 *
 * ## Architecture
 *
 * The component is split into focused modules:
 *
 * | Module | Responsibility |
 * |--------|---------------|
 * | {@link types.ts} | Public interfaces (`Placeholder`, `TemplateEditorProps`) |
 * | {@link dom.ts} | DOM serialization, normalization, chip navigation |
 * | {@link selection.ts} | Serialize / restore caret positions across DOM rebuilds |
 * | {@link useEditorHistory.ts} | Custom undo/redo stack with debouncing |
 * | {@link useSuggestions.ts} | Suggestion dropdown state and keyboard navigation |
 * | **TemplateEditor.tsx** (this file) | Component assembly, event wiring, JSX |
 *
 * ## Serialization Format
 *
 * Placeholders are stored as `{PlaceholderId}` in the `value` string.
 * When rendered, each token becomes a `contenteditable="false"` span.
 *
 * ## Cursor Navigation Trick
 *
 * Browsers struggle to place the caret next to `contenteditable="false"`
 * inline elements. We surround every chip with **zero-width spaces (ZWSP)**
 * via {@link normalizeEditor}. These are invisible to users and stripped
 * during serialization.
 *
 * ## Undo/Redo
 *
 * Because DOM normalization corrupts the browser's native undo stack, we
 * implement our own history manager ({@link useEditorHistory}). It captures
 * value + selection snapshots and supports debounced grouping (500ms window).
 *
 * @module TemplateEditor
 */

import { useRef, useCallback, useEffect } from 'react';
import type { Placeholder, TemplateEditorProps } from './types';
import {
  valueToHtml,
  htmlToValue,
  normalizeEditor,
  findPrevChip,
  findNextChip,
  isCursorAtStart,
  isCursorAtEnd,
  getTextBeforeCursor,
} from './dom';
import { useEditorHistory } from './useEditorHistory';
import { useSuggestions } from './useSuggestions';

export type { Placeholder, TemplateEditorProps } from './types';

/* ------------------------------------------------------------------ */
//  Constants
/* ------------------------------------------------------------------ */

/** CSS class prefix for all editor sub-elements. */
const CSS_PREFIX = 'tep';

/* ------------------------------------------------------------------ */
//  Component
/* ------------------------------------------------------------------ */

/**
 * A rich template editor with placeholder chips and autocomplete.
 *
 * Renders a `contenteditable` div where users can type free-form text
 * and insert non-editable placeholder chips. Chips are triggered by
 * typing `{` or selecting from a suggestion dropdown.
 *
 * ## Features
 * - **Placeholder chips**: Rendered as styled spans, serialized as `{id}`.
 * - **Autocomplete**: Type `{` to open a filtered suggestion list.
 * - **Required chips**: Marked with `required: true`; cannot be deleted.
 * - **Undo/Redo**: Custom stack (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z).
 * - **Copy/Paste**: Pasting `{id}` text auto-converts to chips.
 * - **IME support**: Composition events handled correctly.
 * - **Accessibility**: Suggestions are keyboard-navigable buttons.
 *
 * ## Props
 * See {@link TemplateEditorProps} for the full prop interface.
 *
 * @example
 * ```tsx
 * import TemplateEditor, { Placeholder } from './TemplateEditor';
 *
 * const placeholders: Placeholder[] = [
 *   { id: 'User', label: 'User Name', required: true },
 *   { id: 'OrderId', label: 'Order ID', required: true },
 *   { id: 'StoreName', label: 'Store Name' },
 * ];
 *
 * function MyForm() {
 *   const [template, setTemplate] = useState('Hello {User}!');
 *
 *   return (
 *     <TemplateEditor
 *       value={template}
 *       onChange={setTemplate}
 *       placeholders={placeholders}
 *       placeholder="Type your message..."
 *       minHeight="180px"
 *     />
 *   );
 * }
 * ```
 */
export default function TemplateEditor({
  value,
  onChange,
  placeholders,
  placeholder: placeholderText,
  className = '',
  disabled = false,
  minHeight = '150px',
}: TemplateEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isUpdatingDom = useRef(false);
  const suppressInput = useRef(false);
  const prevValueRef = useRef(value);
  const isComposing = useRef(false);

  const history = useEditorHistory(editorRef, placeholders, onChange);
  const suggestions = useSuggestions(placeholders);

  /* ---------------------------------------------------------------- */
  //  Helpers
  /* ---------------------------------------------------------------- */

  /**
   * Reads the current serialized value from the editor DOM.
   */
  const readValue = useCallback((): string => {
    return editorRef.current ? htmlToValue(editorRef.current) : '';
  }, []);

  /**
   * Emits a value change to the parent and pushes to history.
   * Call this after any user-initiated DOM mutation.
   */
  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    const newVal = readValue();
    prevValueRef.current = newVal;
    onChange(newVal);
    history.push(newVal);
  }, [readValue, onChange, history]);

  /* ---------------------------------------------------------------- */
  //  Placeholder insertion
  /* ---------------------------------------------------------------- */

  /**
   * Inserts a placeholder chip at the current caret position.
   *
   * If the caret is inside a `{...}` trigger pattern, that text is replaced.
   * Otherwise the chip is inserted inline at the cursor.
   */
  const insertPlaceholder = useCallback(
    (ph: Placeholder) => {
      const editor = editorRef.current;
      if (!editor) return;

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;

      const range = sel.getRangeAt(0);
      const container = range.startContainer;
      const offset = range.startOffset;

      // Build the chip element
      const chip = document.createElement('span');
      chip.contentEditable = 'false';
      chip.className = `${CSS_PREFIX}-chip`;
      chip.dataset.id = ph.id;
      if (ph.required) chip.dataset.required = 'true';
      chip.textContent = ph.label;

      if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || '';
        const braceIdx = text.lastIndexOf('{', offset - 1);

        if (braceIdx !== -1) {
          // Replace `{...}` trigger text with the chip
          const beforeBrace = text.substring(0, braceIdx);
          const afterCursor = text.substring(offset);

          if (beforeBrace.length === 0 && afterCursor.length === 0) {
            container.parentNode?.replaceChild(chip, container);
          } else {
            container.textContent = beforeBrace;
            const afterNode = document.createTextNode(afterCursor);
            container.parentNode?.insertBefore(afterNode, container.nextSibling);
            container.parentNode?.insertBefore(chip, afterNode);
          }
        } else {
          // Insert at cursor with surrounding text preserved
          const before = text.substring(0, offset);
          const after = text.substring(offset);
          container.textContent = before;
          const afterNode = document.createTextNode(after);
          container.parentNode?.insertBefore(afterNode, container.nextSibling);
          container.parentNode?.insertBefore(chip, afterNode);
        }
      } else {
        range.deleteContents();
        range.insertNode(chip);
      }

      normalizeEditor(editor);

      // Position caret after the chip (past its trailing ZWSP)
      const newRange = document.createRange();
      const refNode = chip.nextSibling;
      if (refNode && refNode.nodeType === Node.TEXT_NODE) {
        newRange.setStart(refNode, 1);
      } else {
        newRange.setStartAfter(chip);
      }
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      editor.focus();
      suggestions.close();
      suppressInput.current = true;
      emitChange();
    },
    [emitChange, suggestions]
  );

  /* ---------------------------------------------------------------- */
  //  Event handlers
  /* ---------------------------------------------------------------- */

  /**
   * Handles `input` events from the contenteditable surface.
   *
   * Normalizes the DOM, emits the value change, and checks whether the
   * user has typed a `{` trigger that should open the suggestion dropdown.
   */
  const handleInput = useCallback(() => {
    if (isUpdatingDom.current || !editorRef.current || isComposing.current)
      return;

    normalizeEditor(editorRef.current);
    emitChange();

    const before = getTextBeforeCursor();
    if (before === null) return;

    const openMatch = before.match(/\{([^}]*)$/);
    if (openMatch) {
      const filter = openMatch[1];
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editorRef.current) {
        const r = sel.getRangeAt(0);
        const caretRect = r.getBoundingClientRect();
        const editorRect = editorRef.current.getBoundingClientRect();
        suggestions.open(filter, caretRect, editorRect);
      }
      return;
    }

    const closeMatch = before.match(/\{[^}]*\}$/);
    if (closeMatch) {
      suggestions.close();
      return;
    }

    if (suggestions.isOpen && !before.includes('{')) {
      suggestions.close();
    }
  }, [emitChange, suggestions]);

  /**
   * Handles all keyboard interactions.
   *
   * - **Undo/Redo**: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z
   * - **Suggestions**: ArrowUp/Down, Enter, Tab, Escape
   * - **Chip navigation**: ArrowLeft/Right jump over chips
   * - **Deletion**: Backspace/Delete handle chip removal (respects `required`)
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // --- Undo / Redo ---
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        history.redo();
        return;
      }

      // --- Suggestion navigation ---
      if (suggestions.isOpen && suggestions.filtered.length > 0) {
        if (e.key === 'Escape') {
          e.preventDefault();
          suggestions.close();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          suggestions.next();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          suggestions.prev();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = suggestions.filtered[suggestions.activeIndex];
          if (selected) insertPlaceholder(selected);
          return;
        }
      }

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const container = range.startContainer;
      const offset = range.startOffset;

      // --- ArrowLeft: jump over chip ---
      if (e.key === 'ArrowLeft') {
        if (
          container.nodeType === Node.TEXT_NODE &&
          isCursorAtStart(container, offset)
        ) {
          const chip = findPrevChip(container);
          if (chip) {
            e.preventDefault();
            const newRange = document.createRange();
            const prevText = chip.previousSibling;
            if (prevText && prevText.nodeType === Node.TEXT_NODE) {
              newRange.setStart(prevText, (prevText.textContent || '').length);
            } else {
              newRange.setStartBefore(chip);
            }
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
        }
        return;
      }

      // --- ArrowRight: jump over chip ---
      if (e.key === 'ArrowRight') {
        if (
          container.nodeType === Node.TEXT_NODE &&
          isCursorAtEnd(container, offset)
        ) {
          const chip = findNextChip(container);
          if (chip) {
            e.preventDefault();
            const newRange = document.createRange();
            const nextText = chip.nextSibling;
            if (nextText && nextText.nodeType === Node.TEXT_NODE) {
              newRange.setStart(nextText, 1);
            } else {
              newRange.setStartAfter(chip);
            }
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
          }
        }
        return;
      }

      // --- Backspace: delete chip or skip required ---
      if (e.key === 'Backspace') {
        if (!sel.isCollapsed) return;

        if (
          container.nodeType === Node.TEXT_NODE &&
          isCursorAtStart(container, offset)
        ) {
          const chip = findPrevChip(container);
          if (chip) {
            if (chip.dataset.required === 'true') {
              e.preventDefault();
              // Skip over required chip
              const newRange = document.createRange();
              const prevText = chip.previousSibling;
              if (prevText && prevText.nodeType === Node.TEXT_NODE) {
                newRange.setStart(
                  prevText,
                  (prevText.textContent || '').length - 1
                );
              } else {
                newRange.setStartBefore(chip);
              }
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
              return;
            }
            e.preventDefault();
            chip.remove();
            normalizeEditor(editorRef.current!);
            const newRange = document.createRange();
            newRange.setStart(container, 0);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            editorRef.current?.focus();
            suppressInput.current = true;
            emitChange();
          }
        }
        return;
      }

      // --- Delete: delete chip or skip required ---
      if (e.key === 'Delete') {
        if (!sel.isCollapsed) return;

        if (
          container.nodeType === Node.TEXT_NODE &&
          isCursorAtEnd(container, offset)
        ) {
          const chip = findNextChip(container);
          if (chip) {
            if (chip.dataset.required === 'true') {
              e.preventDefault();
              const newRange = document.createRange();
              const nextText = chip.nextSibling;
              if (nextText && nextText.nodeType === Node.TEXT_NODE) {
                newRange.setStart(nextText, 1);
              } else {
                newRange.setStartAfter(chip);
              }
              newRange.collapse(true);
              sel.removeAllRanges();
              sel.addRange(newRange);
            } else {
              e.preventDefault();
              chip.remove();
              normalizeEditor(editorRef.current!);
              suppressInput.current = true;
              emitChange();
            }
          }
        }
        return;
      }
    },
    [history, suggestions, insertPlaceholder, emitChange]
  );

  /**
   * Handles paste events. Plain text is inserted; `{PlaceholderId}` tokens
   * are automatically converted to chips.
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const editor = editorRef.current;
      if (!editor) return;

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      const parts = text.split(/(\{[^}]+\})/);
      const fragment = document.createDocumentFragment();

      for (const part of parts) {
        const m = part.match(/^\{([^}]+)\}$/);
        if (m) {
          const ph = placeholders.find((p) => p.id === m[1]);
          if (ph) {
            const chip = document.createElement('span');
            chip.contentEditable = 'false';
            chip.className = `${CSS_PREFIX}-chip`;
            chip.dataset.id = ph.id;
            if (ph.required) chip.dataset.required = 'true';
            chip.textContent = ph.label;
            fragment.appendChild(chip);
            continue;
          }
        }
        fragment.appendChild(document.createTextNode(part));
      }

      range.deleteContents();
      range.insertNode(fragment);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      normalizeEditor(editor);
      suppressInput.current = true;
      emitChange();
    },
    [placeholders, emitChange]
  );

  /**
   * Handles clicks on chips. Prevents the browser from placing the caret
   * inside the chip. Instead, places the caret either before or after the
   * chip depending on which half was clicked.
   */
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains(`${CSS_PREFIX}-chip`)) return;

    e.preventDefault();
    const sel = window.getSelection();
    if (!sel) return;

    const rect = target.getBoundingClientRect();
    const clickX = e.clientX;
    const midX = rect.left + rect.width / 2;

    const newRange = document.createRange();
    if (clickX < midX) {
      // Clicked left half → place before chip
      const prevText = target.previousSibling;
      if (prevText && prevText.nodeType === Node.TEXT_NODE) {
        newRange.setStart(prevText, (prevText.textContent || '').length);
      } else {
        newRange.setStartBefore(target);
      }
    } else {
      // Clicked right half → place after chip
      const nextText = target.nextSibling;
      if (nextText && nextText.nodeType === Node.TEXT_NODE) {
        newRange.setStart(nextText, 1);
      } else {
        newRange.setStartAfter(target);
      }
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    editorRef.current?.focus();
  }, []);

  /**
   * Prevents default mousedown on chips so the browser doesn't start
   * a text selection inside them.
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains(`${CSS_PREFIX}-chip`)) {
        e.preventDefault();
        handleClick(e);
      }
    },
    [handleClick]
  );

  /**
   * IME composition start — suppresses input handling until composition ends.
   */
  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  /**
   * IME composition end — resumes input handling and processes the final text.
   */
  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false;
    handleInput();
  }, [handleInput]);

  /* ---------------------------------------------------------------- */
  //  Native clipboard events (copy / cut)
  /* ---------------------------------------------------------------- */

  /**
   * Native `copy` and `cut` events are used instead of React's synthetic
   * events because `clipboardData.setData()` is read-only in synthetic
   * ClipboardEvents.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleNativeCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) return;

      e.preventDefault();
      const range = sel.getRangeAt(0);
      const contents = range.cloneContents();
      const valueFormat = htmlToValue(contents);
      e.clipboardData?.setData('text/plain', valueFormat);
    };

    const handleNativeCut = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) return;

      e.preventDefault();
      const range = sel.getRangeAt(0);
      const contents = range.cloneContents();
      const valueFormat = htmlToValue(contents);
      e.clipboardData?.setData('text/plain', valueFormat);

      range.deleteContents();
      sel.removeAllRanges();
      editor.focus();

      normalizeEditor(editor);
      suppressInput.current = true;
      emitChange();
    };

    editor.addEventListener('copy', handleNativeCopy);
    editor.addEventListener('cut', handleNativeCut);
    return () => {
      editor.removeEventListener('copy', handleNativeCopy);
      editor.removeEventListener('cut', handleNativeCut);
    };
  }, [emitChange]);

  /* ---------------------------------------------------------------- */
  //  Lifecycle: init + external value sync
  /* ---------------------------------------------------------------- */

  /** Initialize editor content on first mount. */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = valueToHtml(value, placeholders);
    normalizeEditor(editor);
    prevValueRef.current = value;
    history.reset(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sync external `value` prop changes into the editor DOM. */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === prevValueRef.current) return;
    if (suppressInput.current) {
      suppressInput.current = false;
      return;
    }
    if (history.isApplying()) return;

    isUpdatingDom.current = true;
    editor.innerHTML = valueToHtml(value, placeholders);
    normalizeEditor(editor);
    isUpdatingDom.current = false;
    prevValueRef.current = value;
  }, [value, placeholders, history]);

  /* ---------------------------------------------------------------- */
  //  Render
  /* ---------------------------------------------------------------- */

  return (
    <div className={`${CSS_PREFIX}-root`}>
      <div
        ref={editorRef}
        className={`${CSS_PREFIX}-editor ${className}`}
        contentEditable={!disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        suppressContentEditableWarning
        data-placeholder={placeholderText}
        style={{ minHeight }}
      />

      {suggestions.isOpen && (
        <div
          className={`${CSS_PREFIX}-suggestions`}
          style={{
            top: suggestions.position.top,
            left: suggestions.position.left,
          }}
        >
          {suggestions.filtered.map((ph, i) => (
            <button
              key={ph.id}
              className={`${CSS_PREFIX}-suggestion ${
                i === suggestions.activeIndex ? 'active' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertPlaceholder(ph);
              }}
              onMouseEnter={() => suggestions.setIndex(i)}
              type="button"
            >
              <span className={`${CSS_PREFIX}-suggestion-label`}>{ph.label}</span>
              <span className={`${CSS_PREFIX}-suggestion-id`}>{`{${ph.id}}`}</span>
              {ph.required && (
                <span className={`${CSS_PREFIX}-suggestion-req`}>required</span>
              )}
            </button>
          ))}

          {suggestions.filtered.length === 0 && (
            <div className={`${CSS_PREFIX}-suggestion-empty`}>
              No matching placeholders
            </div>
          )}
        </div>
      )}
    </div>
  );
}
