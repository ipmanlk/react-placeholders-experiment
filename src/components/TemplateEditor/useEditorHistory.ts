/**
 * @fileoverview Custom undo/redo history hook for TemplateEditor.
 *
 * Browsers maintain their own undo stacks for `contenteditable`, but our
 * DOM normalization (inserting zero-width spaces around chips) corrupts
 * that native stack. This hook provides a **custom history manager** that
 * captures meaningful editor states and restores them on Ctrl+Z / Ctrl+Y.
 *
 * States are debounced: rapid typing within 500ms collapses into a single
 * history entry, so undo feels natural (undoes a word/phrase, not a char).
 *
 * @module TemplateEditor/useEditorHistory
 */

import { useRef, useCallback } from 'react';
import type { SerializedSelection } from './selection';
import { getSelectionState, restoreSelectionState } from './selection';
import { valueToHtml, normalizeEditor } from './dom';
import type { Placeholder } from './types';

/** Maximum number of history entries to retain. */
const MAX_HISTORY = 100;

/** Debounce window in ms for collapsing continuous typing into one entry. */
const DEBOUNCE_MS = 500;

/**
 * A single snapshot in the undo/redo stack.
 */
interface HistoryEntry {
  /** Serialized template value at this point in time. */
  value: string;
  /** Cursor position, or null if unavailable. */
  selection: SerializedSelection | null;
}

/**
 * Return type of the {@link useEditorHistory} hook.
 */
export interface EditorHistory {
  /** Push a new state onto the history stack. */
  push: (value: string, selection?: SerializedSelection | null) => void;
  /** Undo the last change. Returns true if an undo was performed. */
  undo: () => boolean;
  /** Redo the previously undone change. Returns true if a redo was performed. */
  redo: () => boolean;
  /** Reset the history to a single initial entry. */
  reset: (value: string) => void;
  /** Whether the hook is currently applying a history entry (prevents re-entry). */
  isApplying: () => boolean;
}

/**
 * Creates an undo/redo history manager bound to a contenteditable editor.
 *
 * @param editorRef - React ref to the editor DOM element.
 * @param placeholders - Placeholder definitions (needed to rebuild HTML).
 * @param onChange - Callback to notify parent of value changes during undo/redo.
 * @returns History control object.
 *
 * @example
 * ```ts
 * const history = useEditorHistory(editorRef, placeholders, onChange);
 *
 * // After every meaningful edit:
 * history.push(newValue);
 *
 * // In key handler:
 * if (ctrlKey && key === 'z') history.undo();
 * ```
 */
export function useEditorHistory(
  editorRef: React.RefObject<HTMLElement | null>,
  placeholders: Placeholder[],
  onChange: (value: string) => void
): EditorHistory {
  const historyRef = useRef<HistoryEntry[]>([]);
  const indexRef = useRef(0);
  const lastPushTimeRef = useRef(0);
  const isApplyingRef = useRef(false);

  /**
   * Rebuilds the editor DOM from a history entry and restores selection.
   */
  const applyEntry = useCallback(
    (entry: HistoryEntry) => {
      const editor = editorRef.current;
      if (!editor) return;

      isApplyingRef.current = true;

      editor.innerHTML = valueToHtml(entry.value, placeholders);
      normalizeEditor(editor);
      onChange(entry.value);

      // Restore selection in the next frame so DOM is fully laid out
      requestAnimationFrame(() => {
        restoreSelectionState(editor, entry.selection);
        isApplyingRef.current = false;
      });
    },
    [editorRef, placeholders, onChange]
  );

  const push = useCallback(
    (value: string, selection?: SerializedSelection | null) => {
      if (isApplyingRef.current) return;

      const now = Date.now();
      const editor = editorRef.current;
      const sel = selection ?? (editor ? getSelectionState(editor) : null);

      const history = historyRef.current;
      const currentIndex = indexRef.current;

      if (now - lastPushTimeRef.current < DEBOUNCE_MS && currentIndex > 0) {
        // Replace current entry for continuous typing
        history[currentIndex] = { value, selection: sel };
      } else {
        // Trim redo branch and append new entry
        if (currentIndex < history.length - 1) {
          historyRef.current = history.slice(0, currentIndex + 1);
        }
        historyRef.current.push({ value, selection: sel });
        indexRef.current = historyRef.current.length - 1;
      }

      lastPushTimeRef.current = now;

      // Enforce max history size
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY);
        indexRef.current = historyRef.current.length - 1;
      }
    },
    [editorRef]
  );

  const undo = useCallback((): boolean => {
    if (indexRef.current <= 0) return false;
    indexRef.current--;
    applyEntry(historyRef.current[indexRef.current]);
    return true;
  }, [applyEntry]);

  const redo = useCallback((): boolean => {
    if (indexRef.current >= historyRef.current.length - 1) return false;
    indexRef.current++;
    applyEntry(historyRef.current[indexRef.current]);
    return true;
  }, [applyEntry]);

  const reset = useCallback((value: string) => {
    historyRef.current = [{ value, selection: null }];
    indexRef.current = 0;
    lastPushTimeRef.current = 0;
  }, []);

  const isApplying = useCallback(() => isApplyingRef.current, []);

  return { push, undo, redo, reset, isApplying };
}
