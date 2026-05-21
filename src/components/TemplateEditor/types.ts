/**
 * @fileoverview Core types and interfaces for the TemplateEditor component.
 *
 * This module defines all public-facing type contracts. Import these when
 * integrating TemplateEditor into your own application or when building
 * wrappers around it.
 *
 * @example
 * ```tsx
 * import TemplateEditor, { Placeholder, TemplateEditorProps } from './TemplateEditor';
 *
 * const placeholders: Placeholder[] = [
 *   { id: 'User', label: 'User Name', required: true },
 *   { id: 'OrderId', label: 'Order ID' },
 * ];
 *
 * <TemplateEditor
 *   value={template}
 *   onChange={setTemplate}
 *   placeholders={placeholders}
 * />
 * ```
 */

/**
 * Represents a single placeholder token that can be inserted into the editor.
 *
 * Placeholders are rendered as non-editable chips inside the contenteditable
 * surface. They are triggered by typing `{` followed by the placeholder id
 * or label, or by selecting from the suggestion dropdown.
 *
 * @example
 * ```ts
 * { id: 'User', label: 'User Name', required: true }
 * // Renders as a chip with text "User Name"
 * // Serializes to "{User}" in the output value
 * ```
 */
export interface Placeholder {
  /** Unique identifier used for serialization (e.g. `{User}`). Must be unique across all placeholders. */
  id: string;

  /** Human-readable label displayed inside the chip. */
  label: string;

  /**
   * When `true`, the chip cannot be deleted with Backspace/Delete.
   * The cursor will skip over it instead.
   * @default false
   */
  required?: boolean;
}

/**
 * Props accepted by the {@link TemplateEditor} component.
 */
export interface TemplateEditorProps {
  /**
   * The current template value. Placeholders are serialized as `{id}`.
   *
   * Example: `"Hello {User}, your order {OrderId} is ready."`
   */
  value: string;

  /**
   * Called whenever the template value changes.
   * Receives the serialized string with `{id}` placeholders.
   */
  onChange: (value: string) => void;

  /**
   * Array of available placeholders. Defines what chips can be inserted
   * and how they render.
   */
  placeholders: Placeholder[];

  /**
   * Placeholder text shown when the editor is empty.
   * @default undefined
   */
  placeholder?: string;

  /**
   * Additional CSS class applied to the contenteditable element.
   * @default ''
   */
  className?: string;

  /**
   * When `true`, the editor is read-only.
   * @default false
   */
  disabled?: boolean;

  /**
   * Minimum CSS height of the editor.
   * @default '150px'
   */
  minHeight?: string;
}
