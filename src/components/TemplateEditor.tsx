import { useState, useRef, useCallback, useEffect } from 'react'

export interface Placeholder {
  id: string
  label: string
  required?: boolean
}

export interface TemplateEditorProps {
  value: string
  onChange: (value: string) => void
  placeholders: Placeholder[]
  placeholder?: string
  className?: string
  disabled?: boolean
  minHeight?: string
}

function escHtml(text: string): string {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function valueToHtml(value: string, phs: Placeholder[]): string {
  return value.split(/(\{[^}]+\})/).map(part => {
    const m = part.match(/^\{([^}]+)\}$/)
    if (m) {
      const ph = phs.find(p => p.id === m[1])
      if (ph) {
        return `<span contenteditable="false" class="tep-chip" data-id="${escHtml(ph.id)}"${ph.required ? ' data-required="true"' : ''}>${escHtml(ph.label)}</span>`
      }
    }
    return escHtml(part)
  }).join('')
}

function htmlToValue(el: Node): string {
  let out = ''
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE && node.parentElement?.classList.contains('tep-chip')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent
    } else if (n instanceof HTMLElement && !n.isContentEditable && n.classList.contains('tep-chip')) {
      out += `{${n.dataset.id || ''}}`
    }
  }
  return out
}

function findPrevChip(node: Node): HTMLElement | null {
  let prev: Node | null = node.previousSibling
  while (prev) {
    if (prev instanceof HTMLElement && !prev.isContentEditable && prev.classList.contains('tep-chip')) return prev
    if (prev.nodeType === Node.TEXT_NODE && prev.textContent) break
    if (prev instanceof HTMLElement && prev.isContentEditable !== false) break
    prev = prev.previousSibling
  }
  return null
}

function findNextChip(node: Node): HTMLElement | null {
  let next: Node | null = node.nextSibling
  while (next) {
    if (next instanceof HTMLElement && !next.isContentEditable && next.classList.contains('tep-chip')) return next
    if (next.nodeType === Node.TEXT_NODE && next.textContent) break
    if (next instanceof HTMLElement && next.isContentEditable !== false) break
    next = next.nextSibling
  }
  return null
}

export default function TemplateEditor({
  value,
  onChange,
  placeholders,
  placeholder: placeholderText,
  className = '',
  disabled = false,
  minHeight = '150px',
}: TemplateEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [filterText, setFilterText] = useState('')
  const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 })
  const isUpdatingDom = useRef(false)
  const suppressInput = useRef(false)
  const prevValueRef = useRef(value)

  // Set initial content
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = valueToHtml(value, placeholders)
      prevValueRef.current = value
    }
  }, [])

  // Sync external value changes
  useEffect(() => {
    if (!editorRef.current) return
    if (value === prevValueRef.current) return
    if (suppressInput.current) {
      suppressInput.current = false
      return
    }
    isUpdatingDom.current = true
    editorRef.current.innerHTML = valueToHtml(value, placeholders)
    isUpdatingDom.current = false
    prevValueRef.current = value
  }, [value, placeholders])

  const readValue = useCallback((): string => {
    return editorRef.current ? htmlToValue(editorRef.current) : ''
  }, [])

  const getTextBeforeCursor = useCallback((): string | null => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    const offset = range.startOffset
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').substring(0, offset)
    }
    return null
  }, [])

  const insertPlaceholder = useCallback((ph: Placeholder) => {
    if (!editorRef.current) return
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return

    const range = sel.getRangeAt(0)
    const container = range.startContainer
    const offset = range.startOffset

    const chip = document.createElement('span')
    chip.contentEditable = 'false'
    chip.className = 'tep-chip'
    chip.dataset.id = ph.id
    if (ph.required) chip.dataset.required = 'true'
    chip.textContent = ph.label

    if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent || ''
      const braceIdx = text.lastIndexOf('{', offset - 1)

      if (braceIdx !== -1) {
        // Remove from { to cursor, insert chip
        const beforeBrace = text.substring(0, braceIdx)
        const afterCursor = text.substring(offset)

        if (beforeBrace.length === 0 && afterCursor.length === 0) {
          container.parentNode?.replaceChild(chip, container)
        } else {
          container.textContent = beforeBrace + afterCursor
          container.parentNode?.insertBefore(chip, container.nextSibling)
        }
      } else {
        // No brace, insert at cursor position
        const before = text.substring(0, offset)
        const after = text.substring(offset)
        container.textContent = before
        container.parentNode?.insertBefore(chip, container.nextSibling)
        if (after) {
          const afterNode = document.createTextNode(after)
          container.parentNode?.insertBefore(afterNode, chip.nextSibling)
        }
      }
    } else {
      range.deleteContents()
      range.insertNode(chip)
    }

    // Move cursor after chip
    const newRange = document.createRange()
    const refNode = chip.nextSibling
    if (refNode) {
      newRange.setStartBefore(refNode)
    } else {
      newRange.setStartAfter(chip)
    }
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)

    editorRef.current.focus()
    setShowSuggestions(false)
    suppressInput.current = true
    const newVal = readValue()
    prevValueRef.current = newVal
    onChange(newVal)
  }, [readValue, onChange])

  const handleInput = useCallback(() => {
    if (isUpdatingDom.current || !editorRef.current) return

    const newVal = readValue()
    prevValueRef.current = newVal
    onChange(newVal)

    // Check for { trigger pattern
    const before = getTextBeforeCursor()
    if (before !== null) {
      const openMatch = before.match(/\{([^}]*)$/)
      if (openMatch) {
        setFilterText(openMatch[1])
        setShowSuggestions(true)
        setSuggestionIndex(0)

        const sel = window.getSelection()
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0)
          const rect = r.getBoundingClientRect()
          const editorRect = editorRef.current.getBoundingClientRect()
          setSuggestionPos({
            top: rect.bottom - editorRect.top,
            left: rect.left - editorRect.left,
          })
        }
      } else {
        const closeMatch = before.match(/\{[^}]*\}$/)
        if (closeMatch) setShowSuggestions(false)
        // Also hide suggestions if cursor moved away from the pattern
        if (showSuggestions && !before.includes('{')) {
          setShowSuggestions(false)
        }
      }
    }
  }, [readValue, onChange, getTextBeforeCursor, showSuggestions])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const filtered = showSuggestions
      ? placeholders.filter(ph => {
          const f = filterText.toLowerCase()
          return !f || ph.id.toLowerCase().includes(f) || ph.label.toLowerCase().includes(f)
        })
      : []

    if (showSuggestions && filtered.length > 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestionIndex(i => (i + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestionIndex(i => (i - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = filtered[suggestionIndex]
        if (selected) insertPlaceholder(selected)
        return
      }
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return
      const range = sel.getRangeAt(0)
      const container = range.startContainer
      const offset = range.startOffset

      if (container.nodeType === Node.TEXT_NODE && offset === 0) {
        const chip = findPrevChip(container)
        if (chip) {
          if (chip.dataset.required === 'true') {
            e.preventDefault()
            const newRange = document.createRange()
            newRange.setStartBefore(chip)
            newRange.collapse(true)
            sel.removeAllRanges()
            sel.addRange(newRange)
            return
          }
          e.preventDefault()
          chip.remove()
          const newRange = document.createRange()
          newRange.setStart(container, 0)
          newRange.collapse(true)
          sel.removeAllRanges()
          sel.addRange(newRange)
          editorRef.current?.focus()
          suppressInput.current = true
          const newVal = readValue()
          prevValueRef.current = newVal
          onChange(newVal)
        }
      }
    }

    if (e.key === 'Delete') {
      const sel = window.getSelection()
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return
      const range = sel.getRangeAt(0)
      const container = range.startContainer
      const offset = range.startOffset

      if (container.nodeType === Node.TEXT_NODE && offset >= (container.textContent || '').length) {
        const chip = findNextChip(container)
        if (chip) {
          e.preventDefault()
          if (chip.dataset.required === 'true') {
            const newRange = document.createRange()
            newRange.setStartAfter(chip)
            newRange.collapse(true)
            sel.removeAllRanges()
            sel.addRange(newRange)
          } else {
            chip.remove()
            if (container.textContent === '' && container.parentNode) {
              container.parentNode.removeChild(container)
            }
            suppressInput.current = true
            const newVal = readValue()
            prevValueRef.current = newVal
            onChange(newVal)
          }
        }
      }
    }
  }, [showSuggestions, suggestionIndex, filterText, placeholders, insertPlaceholder, readValue, onChange])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!editorRef.current) return

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)

    const parts = text.split(/(\{[^}]+\})/)
    const fragment = document.createDocumentFragment()

    for (const part of parts) {
      const m = part.match(/^\{([^}]+)\}$/)
      if (m) {
        const ph = placeholders.find(p => p.id === m[1])
        if (ph) {
          const chip = document.createElement('span')
          chip.contentEditable = 'false'
          chip.className = 'tep-chip'
          chip.dataset.id = ph.id
          if (ph.required) chip.dataset.required = 'true'
          chip.textContent = ph.label
          fragment.appendChild(chip)
          continue
        }
      }
      fragment.appendChild(document.createTextNode(part))
    }

    range.deleteContents()
    range.insertNode(fragment)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)

    suppressInput.current = true
    const newVal = readValue()
    prevValueRef.current = newVal
    onChange(newVal)
  }, [placeholders, readValue, onChange])

  const handleCut = useCallback((e: React.ClipboardEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !editorRef.current) return

    e.preventDefault()
    const range = sel.getRangeAt(0)
    const contents = range.cloneContents()
    const valueFormat = htmlToValue(contents)
    e.clipboardData.setData('text/plain', valueFormat)

    range.deleteContents()
    sel.removeAllRanges()
    editorRef.current.focus()

    suppressInput.current = true
    const newVal = readValue()
    prevValueRef.current = newVal
    onChange(newVal)
  }, [readValue, onChange])

  return (
    <div className="tep-root">
      <div
        ref={editorRef}
        className={`tep-editor ${className}`}
        contentEditable={!disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCut={handleCut}
        suppressContentEditableWarning
        data-placeholder={placeholderText}
        style={{ minHeight }}
      />
      {showSuggestions && (
        <div
          className="tep-suggestions"
          style={{ top: suggestionPos.top, left: suggestionPos.left }}
        >
          {placeholders
            .filter(ph => {
              const f = filterText.toLowerCase()
              return !f || ph.id.toLowerCase().includes(f) || ph.label.toLowerCase().includes(f)
            })
            .map((ph, i) => (
              <button
                key={ph.id}
                className={`tep-suggestion ${i === suggestionIndex ? 'active' : ''}`}
                onMouseDown={e => {
                  e.preventDefault()
                  insertPlaceholder(ph)
                }}
                onMouseEnter={() => setSuggestionIndex(i)}
                type="button"
              >
                <span className="tep-suggestion-label">{ph.label}</span>
                <span className="tep-suggestion-id">{`{${ph.id}}`}</span>
                {ph.required && <span className="tep-suggestion-req">required</span>}
              </button>
            ))}
          {filterText && placeholders.filter(ph => {
            const f = filterText.toLowerCase()
            return !f || ph.id.toLowerCase().includes(f) || ph.label.toLowerCase().includes(f)
          }).length === 0 && (
            <div className="tep-suggestion-empty">No matching placeholders</div>
          )}
        </div>
      )}
    </div>
  )
}
