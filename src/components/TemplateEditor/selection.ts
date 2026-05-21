/**
 * @fileoverview Selection serialization utilities for TemplateEditor.
 *
 * Because the editor DOM is frequently rebuilt (on undo/redo, external value
 * sync, placeholder insertion), we cannot store raw DOM references for cursor
 * position. Instead, we serialize selections as "node paths" (child indices
 * from the editor root) plus an offset, which can be restored after any
 * DOM reconstruction.
 *
 * @module TemplateEditor/selection
 */

/**
 * Serializable representation of a text caret position.
 *
 * The `nodePath` is an array of child indices starting from the editor root.
 * For example, `[0, 2]` means: root → first child → third child of that.
 *
 * @example
 * ```ts
 * { nodePath: [1, 0], offset: 5 }
 * // caret is at offset 5 inside the first child of the second root child
 * ```
 */
export interface SerializedSelection {
  /** Child-index path from the editor root to the target node. */
  nodePath: number[];
  /** Character offset (for text nodes) or child index (for element nodes). */
  offset: number;
}

/**
 * Computes the child-index path from `root` to `target`.
 *
 * Walks up the parent chain, counting sibling positions at each level.
 * The resulting path can be passed to {@link getNodeFromPath} to recover
 * the node after DOM reconstruction.
 *
 * @param root - The ancestor container (typically the editor element).
 * @param target - The node whose path we want.
 * @returns Array of child indices from root to target.
 *
 * @example
 * ```ts
 * const path = getNodePath(editor, textNode); // [1, 0]
 * ```
 */
export function getNodePath(root: Node, target: Node): number[] {
  const path: number[] = [];
  let node: Node | null = target;

  while (node && node !== root) {
    const parentNode: Node | null = node.parentNode;
    if (!parentNode) break;

    let index = 0;
    let sibling: Node | null = parentNode.firstChild;
    while (sibling && sibling !== node) {
      sibling = sibling.nextSibling;
      index++;
    }
    path.unshift(index);
    node = parentNode;
  }

  return path;
}

/**
 * Resolves a child-index path back to a DOM node.
 *
 * @param root - The ancestor container (typically the editor element).
 * @param path - Array of child indices from root to target.
 * @returns The resolved node, or `null` if the path is invalid.
 *
 * @example
 * ```ts
 * const node = getNodeFromPath(editor, [1, 0]);
 * ```
 */
export function getNodeFromPath(root: Node, path: number[]): Node | null {
  let node: Node | null = root;
  for (const index of path) {
    if (!node) return null;
    node = node.childNodes[index] || null;
  }
  return node;
}

/**
 * Serializes the current text caret position relative to an editor root.
 *
 * @param root - The editor element.
 * @returns A serializable selection snapshot, or `null` if no selection exists.
 */
export function getSelectionState(root: HTMLElement): SerializedSelection | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  try {
    return {
      nodePath: getNodePath(root, range.startContainer),
      offset: range.startOffset,
    };
  } catch {
    return null;
  }
}

/**
 * Restores a text caret position from a serialized snapshot.
 *
 * The DOM must already be reconstructed before calling this. If the path
 * no longer resolves to a valid node, the restoration is silently skipped.
 *
 * @param root - The editor element.
 * @param state - Serialized selection from {@link getSelectionState}.
 */
export function restoreSelectionState(
  root: HTMLElement,
  state: SerializedSelection | null
): void {
  if (!state) return;

  const node = getNodeFromPath(root, state.nodePath);
  if (!node) return;

  const sel = window.getSelection();
  if (!sel) return;

  try {
    const range = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
      const maxOffset = (node.textContent || '').length;
      range.setStart(node, Math.min(state.offset, maxOffset));
    } else {
      range.setStart(node, Math.min(state.offset, node.childNodes.length));
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // Silently ignore invalid selection restoration
  }
}
