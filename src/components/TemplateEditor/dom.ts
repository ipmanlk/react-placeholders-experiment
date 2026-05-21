/**
 * @fileoverview DOM serialization utilities for TemplateEditor.
 *
 * This module handles the bidirectional conversion between the serialized
 * string format (with `{PlaceholderId}` tokens) and the rendered HTML
 * representation (with `contenteditable="false"` chip spans).
 *
 * @module TemplateEditor/dom
 */

import type { Placeholder } from './types';

/** Unicode zero-width space used as cursor anchors around non-editable chips. */
export const ZWSP = '\u200B';

/**
 * Escapes HTML special characters in a plain-text string so it can be
 * safely inserted as HTML text content.
 *
 * @param text - Raw text that may contain `<`, `>`, `&`, or quotes.
 * @returns HTML-escaped string safe for innerHTML insertion.
 *
 * @example
 * ```ts
 * escHtml('<script>') // '&lt;script&gt;'
 * ```
 */
export function escHtml(text: string): string {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

/**
 * Converts a serialized template value into HTML for rendering inside the
 * contenteditable editor.
 *
 * Placeholder tokens in the form `{PlaceholderId}` are replaced with
 * `span.tep-chip` elements. All other text is HTML-escaped.
 *
 * @param value - Serialized template string (e.g. `"Hello {User}"`).
 * @param phs - Array of placeholder definitions used to resolve ids to labels.
 * @returns HTML string ready for `element.innerHTML`.
 *
 * @example
 * ```ts
 * const html = valueToHtml('Hi {User}', [{ id: 'User', label: 'User' }]);
 * // '<span contenteditable="false" class="tep-chip" data-id="User">User</span>'
 * ```
 */
export function valueToHtml(value: string, phs: Placeholder[]): string {
  if (!value) return '';
  return value
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const m = part.match(/^\{([^}]+)\}$/);
      if (m) {
        const ph = phs.find((p) => p.id === m[1]);
        if (ph) {
          const requiredAttr = ph.required ? ' data-required="true"' : '';
          return `<span contenteditable="false" class="tep-chip" data-id="${escHtml(ph.id)}"${requiredAttr}>${escHtml(ph.label)}</span>`;
        }
      }
      return escHtml(part);
    })
    .join('');
}

/**
 * Extracts the serialized template value from the editor's live DOM.
 *
 * Walks the DOM tree and converts `span.tep-chip` elements back into
 * `{PlaceholderId}` tokens. Text nodes are concatenated as-is.
 *
 * @param el - The editor root element (or any subtree).
 * @returns Serialized string with `{id}` placeholders.
 *
 * @example
 * ```ts
 * const value = htmlToValue(editorDiv);
 * // 'Hello {User}, your order is ready.'
 * ```
 */
export function htmlToValue(el: Node): string {
  let out = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      // Skip text inside chip spans — the chip itself carries the token
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.parentElement?.classList.contains('tep-chip')
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent;
    } else if (
      n instanceof HTMLElement &&
      !n.isContentEditable &&
      n.classList.contains('tep-chip')
    ) {
      out += `{${n.dataset.id || ''}}`;
    }
  }
  return out;
}

/**
 * Normalizes the editor DOM by ensuring every chip has zero-width space
 * (ZWSP) text nodes immediately before and after it.
 *
 * These invisible anchors are critical for cross-browser cursor navigation:
 * without them, the caret cannot be placed adjacent to a
 * `contenteditable="false"` element in many browsers.
 *
 * Also deduplicates consecutive ZWSP nodes.
 *
 * @param editor - The editor root element.
 *
 * @remarks
 * This is a **lossless** DOM mutation. It does not affect the serialized
 * value because ZWSP characters are stripped during `htmlToValue`.
 */
export function normalizeEditor(editor: HTMLElement): void {
  const chips = editor.querySelectorAll('.tep-chip');

  for (const chip of chips) {
    const prev = chip.previousSibling;
    const next = chip.nextSibling;

    // Ensure ZWSP before chip
    if (
      !prev ||
      (prev.nodeType === Node.TEXT_NODE && !(prev.textContent || '').endsWith(ZWSP))
    ) {
      chip.parentNode?.insertBefore(document.createTextNode(ZWSP), chip);
    }

    // Ensure ZWSP after chip
    if (
      !next ||
      (next.nodeType === Node.TEXT_NODE && !(next.textContent || '').startsWith(ZWSP))
    ) {
      chip.parentNode?.insertBefore(document.createTextNode(ZWSP), chip.nextSibling);
    }
  }

  // Deduplicate consecutive ZWSP nodes
  let node: Node | null = editor.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === Node.TEXT_NODE && node.textContent === ZWSP + ZWSP) {
      node.textContent = ZWSP;
    }
    node = next;
  }
}

/**
 * Finds the nearest previous chip sibling of a given node, skipping over
 * ZWSP text nodes and other non-content nodes.
 *
 * @param node - The starting node (typically a text node).
 * @returns The previous chip element, or `null` if none exists.
 */
export function findPrevChip(node: Node): HTMLElement | null {
  let prev: Node | null = node.previousSibling;
  while (prev) {
    if (
      prev instanceof HTMLElement &&
      !prev.isContentEditable &&
      prev.classList.contains('tep-chip')
    )
      return prev;
    if (prev.nodeType === Node.TEXT_NODE && prev.textContent && prev.textContent !== ZWSP)
      break;
    if (prev instanceof HTMLElement && prev.isContentEditable !== false) break;
    prev = prev.previousSibling;
  }
  return null;
}

/**
 * Finds the nearest next chip sibling of a given node, skipping over
 * ZWSP text nodes and other non-content nodes.
 *
 * @param node - The starting node (typically a text node).
 * @returns The next chip element, or `null` if none exists.
 */
export function findNextChip(node: Node): HTMLElement | null {
  let next: Node | null = node.nextSibling;
  while (next) {
    if (
      next instanceof HTMLElement &&
      !next.isContentEditable &&
      next.classList.contains('tep-chip')
    )
      return next;
    if (next.nodeType === Node.TEXT_NODE && next.textContent && next.textContent !== ZWSP)
      break;
    if (next instanceof HTMLElement && next.isContentEditable !== false) break;
    next = next.nextSibling;
  }
  return null;
}

/**
 * Checks whether the caret is at the visual start of a text node,
 * accounting for the leading ZWSP that may precede actual content.
 *
 * @param node - The text node containing the caret.
 * @param offset - The caret offset within the node.
 * @returns `true` if the caret is at the start (ignoring ZWSP).
 */
export function isCursorAtStart(node: Node, offset: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    return (
      offset <= 1 ||
      text.substring(0, offset).replace(new RegExp(ZWSP, 'g'), '').length === 0
    );
  }
  return offset === 0;
}

/**
 * Checks whether the caret is at the visual end of a text node,
 * accounting for the trailing ZWSP that may follow actual content.
 *
 * @param node - The text node containing the caret.
 * @param offset - The caret offset within the node.
 * @returns `true` if the caret is at the end (ignoring ZWSP).
 */
export function isCursorAtEnd(node: Node, offset: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    return (
      offset >= text.length - 1 ||
      text.substring(offset).replace(new RegExp(ZWSP, 'g'), '').length === 0
    );
  }
  const children = (node as HTMLElement).childNodes;
  return offset >= children.length;
}

/**
 * Returns the plain text content before the current caret position.
 * Only works when the caret is inside a text node.
 *
 * @returns The text before the cursor, or `null` if selection is unavailable.
 */
export function getTextBeforeCursor(): string | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').substring(0, offset);
  }
  return null;
}
