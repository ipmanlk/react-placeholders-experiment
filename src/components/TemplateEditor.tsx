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

const ZWSP = '\u200B'

interface HistoryEntry {
  value: string
  selection: { nodePath: number[]; offset: number } | null
}

function escHtml(text: string): string {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function valueToHtml(value: string, phs: Placeholder[]): string {
  if (!value) return ''
  return value.split(/(\{[^}]+\})/).map(part => {
    const m = part.match(/^\{([^}]+)\}$/)
    if (m) {
      const ph = phs.find(p => p.id === m[1])
      if (ph) {
        return `\u003cspan contenteditable="false" class="tep-chip" data-id="${escHtml(ph.id)}"${ph.required ? ' data-required="true"' : ''}\u003e${escHtml(ph.label)}\u003c/span\u003e`
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

function getNodePath(root: Node, target: Node): number[] {
  const path: number[] = []
  let node: Node | null = target
  while (node && node !== root) {
    const parentNode: Node | null = node.parentNode
    if (!parentNode) break
    let index = 0
    let sibling: Node | null = parentNode.firstChild
    while (sibling && sibling !== node) {
      sibling = sibling.nextSibling
      index++
    }
    path.unshift(index)
    node = parentNode
  }
  return path
}

function getNodeFromPath(root: Node, path: number[]): Node | null {
  let node: Node | null = root
  for (const index of path) {
    if (!node) return null
    node = node.childNodes[index] || null
  }
  return node
}

function getSelectionState(root: HTMLElement): HistoryEntry['selection'] {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  try {
    return {
      nodePath: getNodePath(root, range.startContainer),
      offset: range.startOffset,
    }
  } catch {
    return null
  }
}

function restoreSelectionState(root: HTMLElement, state: HistoryEntry['selection']): void {
  if (!state) return
  const node = getNodeFromPath(root, state.nodePath)
  if (!node) return
  const sel = window.getSelection()
  if (!sel) return
  try {
    const range = document.createRange()
    if (node.nodeType === Node.TEXT_NODE) {
      const maxOffset = (node.textContent || '').length
      range.setStart(node, Math.min(state.offset, maxOffset))
    } else {
      range.setStart(node, Math.min(state.offset, node.childNodes.length))
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch {
    // Ignore invalid selection restoration
  }
}

function findPrevChip(node: Node): HTMLElement | null {
  let prev: Node | null = node.previousSibling
  while (prev) {
    if (prev instanceof HTMLElement && !prev.isContentEditable && prev.classList.contains('tep-chip')) return prev
    if (prev.nodeType === Node.TEXT_NODE && prev.textContent && prev.textContent !== ZWSP) break
    if (prev instanceof HTMLElement && prev.isContentEditable !== false) break
    prev = prev.previousSibling
  }
  return null
}

function findNextChip(node: Node): HTMLElement | null {
  let next: Node | null = node.nextSibling
  while (next) {
    if (next instanceof HTMLElement && !next.isContentEditable && next.classList.contains('tep-chip')) return next
    if (next.nodeType === Node.TEXT_NODE && next.textContent && next.textContent !== ZWSP) break
    if (next instanceof HTMLElement && next.isContentEditable !== false) break
    next = next.nextSibling
  }
  return null
}

function isCursorAtStart(node: Node, offset: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return offset <= 1 || text.substring(0, offset).replace(new RegExp(ZWSP, 'g'), '').length === 0
  }
  return offset === 0
}

function isCursorAtEnd(node: Node, offset: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return offset >= text.length - 1 || text.substring(offset).replace(new RegExp(ZWSP, 'g'), '').length === 0
  }
  const children = (node as HTMLElement).childNodes
  return offset >= children.length
}

function normalizeEditor(editor: HTMLElement): void {
  const chips = editor.querySelectorAll('.tep-chip')
  for (const chip of chips) {
    const prev = chip.previousSibling
    const next = chip.nextSibling
    if (!prev || (prev.nodeType === Node.TEXT_NODE && !(prev.textContent || '').endsWith(ZWSP))) {
      const zwspNode = document.createTextNode(ZWSP)
      chip.parentNode?.insertBefore(zwspNode, chip)
    }
    if (!next || (next.nodeType === Node.TEXT_NODE && !(next.textContent || '').startsWith(ZWSP))) {
      const zwspNode = document.createTextNode(ZWSP)
      chip.parentNode?.insertBefore(zwspNode, chip.nextSibling)
    }
  }
  let node = editor.firstChild
  while (node) {
    const next = node.nextSibling
    if (node.nodeType === Node.TEXT_NODE && node.textContent === ZWSP + ZWSP) {
      node.textContent = ZWSP
    }
    node = next
  }
}

function getTextBeforeCursor(): string | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').substring(0, offset)
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
  const isComposing = useRef(false)

  // Custom undo/redo stack
  const historyRef = useRef<HistoryEntry[]>([{ value, selection: null }])
  const historyIndexRef = useRef(0)
  const lastPushTimeRef = useRef(0)
  const isUndoingRef = useRef(false)

  const pushHistory = useCallback((newValue: string, selection?: HistoryEntry['selection']) => {
    if (isUndoingRef.current) return
    const now = Date.now()
    const editor = editorRef.current
    const sel = selection ?? (editor ? getSelectionState(editor) : null)

    // Debounce: if last push was < 500ms ago and value is similar, replace it
    const history = historyRef.current
    const currentIndex = historyIndexRef.current
    if (now - lastPushTimeRef.current < 500 && currentIndex > 0) {
      // Replace the current entry for continuous typing
      history[currentIndex] = { value: newValue, selection: sel }
    } else {
      // Trim any redo states and push new state
      if (currentIndex < history.length - 1) {
        historyRef.current = history.slice(0, currentIndex + 1)
      }
      historyRef.current.push({ value: newValue, selection: sel })
      historyIndexRef.current = historyRef.current.length - 1
    }
    lastPushTimeRef.current = now

    // Limit history size
    if (historyRef.current.length > 100) {
      historyRef.current = historyRef.current.slice(-100)
      historyIndexRef.current = historyRef.current.length - 1
    }
  }, [])

  const applyHistoryEntry = useCallback((entry: HistoryEntry) => {
    const editor = editorRef.current
    if (!editor) return
    isUndoingRef.current = true
    isUpdatingDom.current = true

    editor.innerHTML = valueToHtml(entry.value, placeholders)
    normalizeEditor(editor)
    prevValueRef.current = entry.value
    onChange(entry.value)

    // Restore selection after DOM update
    requestAnimationFrame(() => {
      restoreSelectionState(editor, entry.selection)
      isUpdatingDom.current = false
      isUndoingRef.current = false
    })
  }, [placeholders, onChange])

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--
      const entry = historyRef.current[historyIndexRef.current]
      applyHistoryEntry(entry)
    }
  }, [applyHistoryEntry])

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++
      const entry = historyRef.current[historyIndexRef.current]
      applyHistoryEntry(entry)
    }
  }, [applyHistoryEntry])

  // Set initial content
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = valueToHtml(value, placeholders)
      normalizeEditor(editorRef.current)
      prevValueRef.current = value
      historyRef.current = [{ value, selection: null }]
      historyIndexRef.current = 0
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
    normalizeEditor(editorRef.current)
    isUpdatingDom.current = false
    prevValueRef.current = value
  }, [value, placeholders])

  const readValue = useCallback((): string => {
    return editorRef.current ? htmlToValue(editorRef.current) : ''
  }, [])

  const emitChange = useCallback(() => {
    if (!editorRef.current) return
    const newVal = readValue()
    prevValueRef.current = newVal
    onChange(newVal)
    pushHistory(newVal)
  }, [readValue, onChange, pushHistory])

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
        const beforeBrace = text.substring(0, braceIdx)
        const afterCursor = text.substring(offset)

        if (beforeBrace.length === 0 && afterCursor.length === 0) {
          container.parentNode?.replaceChild(chip, container)
        } else {
          container.textContent = beforeBrace
          const afterNode = document.createTextNode(afterCursor)
          container.parentNode?.insertBefore(afterNode, container.nextSibling)
          container.parentNode?.insertBefore(chip, afterNode)
        }
      } else {
        const before = text.substring(0, offset)
        const after = text.substring(offset)
        container.textContent = before
        const afterNode = document.createTextNode(after)
        container.parentNode?.insertBefore(afterNode, container.nextSibling)
        container.parentNode?.insertBefore(chip, afterNode)
      }
    } else {
      range.deleteContents()
      range.insertNode(chip)
    }

    normalizeEditor(editorRef.current)

    const newRange = document.createRange()
    const refNode = chip.nextSibling
    if (refNode && refNode.nodeType === Node.TEXT_NODE) {
      newRange.setStart(refNode, 1)
    } else {
      newRange.setStartAfter(chip)
    }
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)

    editorRef.current.focus()
    setShowSuggestions(false)
    suppressInput.current = true
    emitChange()
  }, [emitChange])

  const handleInput = useCallback(() => {
    if (isUpdatingDom.current || !editorRef.current || isComposing.current) return

    normalizeEditor(editorRef.current)
    emitChange()

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
        if (showSuggestions && !before.includes('{')) {
          setShowSuggestions(false)
        }
      }
    }
  }, [emitChange, showSuggestions])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Handle undo/redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
      return
    }

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

    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const container = range.startContainer
    const offset = range.startOffset

    if (e.key === 'ArrowLeft') {
      if (container.nodeType === Node.TEXT_NODE && isCursorAtStart(container, offset)) {
        const chip = findPrevChip(container)
        if (chip) {
          e.preventDefault()
          const newRange = document.createRange()
          const prevText = chip.previousSibling
          if (prevText && prevText.nodeType === Node.TEXT_NODE) {
            newRange.setStart(prevText, (prevText.textContent || '').length)
          } else {
            newRange.setStartBefore(chip)
          }
          newRange.collapse(true)
          sel.removeAllRanges()
          sel.addRange(newRange)
        }
      }
      return
    }

    if (e.key === 'ArrowRight') {
      if (container.nodeType === Node.TEXT_NODE && isCursorAtEnd(container, offset)) {
        const chip = findNextChip(container)
        if (chip) {
          e.preventDefault()
          const newRange = document.createRange()
          const nextText = chip.nextSibling
          if (nextText && nextText.nodeType === Node.TEXT_NODE) {
            newRange.setStart(nextText, 1)
          } else {
            newRange.setStartAfter(chip)
          }
          newRange.collapse(true)
          sel.removeAllRanges()
          sel.addRange(newRange)
        }
      }
      return
    }

    if (e.key === 'Backspace') {
      if (!sel.isCollapsed) return

      if (container.nodeType === Node.TEXT_NODE && isCursorAtStart(container, offset)) {
        const chip = findPrevChip(container)
        if (chip) {
          if (chip.dataset.required === 'true') {
            e.preventDefault()
            const newRange = document.createRange()
            const prevText = chip.previousSibling
            if (prevText && prevText.nodeType === Node.TEXT_NODE) {
              newRange.setStart(prevText, (prevText.textContent || '').length - 1)
            } else {
              newRange.setStartBefore(chip)
            }
            newRange.collapse(true)
            sel.removeAllRanges()
            sel.addRange(newRange)
            return
          }
          e.preventDefault()
          chip.remove()
          normalizeEditor(editorRef.current!)
          const newRange = document.createRange()
          newRange.setStart(container, 0)
          newRange.collapse(true)
          sel.removeAllRanges()
          sel.addRange(newRange)
          editorRef.current?.focus()
          suppressInput.current = true
          emitChange()
        }
      }
      return
    }

    if (e.key === 'Delete') {
      if (!sel.isCollapsed) return

      if (container.nodeType === Node.TEXT_NODE && isCursorAtEnd(container, offset)) {
        const chip = findNextChip(container)
        if (chip) {
          e.preventDefault()
          if (chip.dataset.required === 'true') {
            const newRange = document.createRange()
            const nextText = chip.nextSibling
            if (nextText && nextText.nodeType === Node.TEXT_NODE) {
              newRange.setStart(nextText, 1)
            } else {
              newRange.setStartAfter(chip)
            }
            newRange.collapse(true)
            sel.removeAllRanges()
            sel.addRange(newRange)
          } else {
            chip.remove()
            normalizeEditor(editorRef.current!)
            suppressInput.current = true
            emitChange()
          }
        }
      }
      return
    }
  }, [showSuggestions, suggestionIndex, filterText, placeholders, insertPlaceholder, emitChange, undo, redo])

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

    normalizeEditor(editorRef.current)
    suppressInput.current = true
    emitChange()
  }, [placeholders, emitChange])

  // Native cut/copy handlers for proper clipboard access
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleNativeCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) return

      e.preventDefault()
      const range = sel.getRangeAt(0)
      const contents = range.cloneContents()
      const valueFormat = htmlToValue(contents)
      e.clipboardData?.setData('text/plain', valueFormat)
    }

    const handleNativeCut = (e: ClipboardEvent) => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) return

      e.preventDefault()
      const range = sel.getRangeAt(0)
      const contents = range.cloneContents()
      const valueFormat = htmlToValue(contents)
      e.clipboardData?.setData('text/plain', valueFormat)

      range.deleteContents()
      sel.removeAllRanges()
      editor.focus()

      normalizeEditor(editor)
      suppressInput.current = true
      emitChange()
    }

    editor.addEventListener('copy', handleNativeCopy)
    editor.addEventListener('cut', handleNativeCut)
    return () => {
      editor.removeEventListener('copy', handleNativeCopy)
      editor.removeEventListener('cut', handleNativeCut)
    }
  }, [emitChange])

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false
    handleInput()
  }, [handleInput])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('tep-chip')) {
      e.preventDefault()
      const sel = window.getSelection()
      if (!sel) return

      const rect = target.getBoundingClientRect()
      const clickX = e.clientX
      const midX = rect.left + rect.width / 2

      const newRange = document.createRange()
      if (clickX < midX) {
        const prevText = target.previousSibling
        if (prevText && prevText.nodeType === Node.TEXT_NODE) {
          newRange.setStart(prevText, (prevText.textContent || '').length)
        } else {
          newRange.setStartBefore(target)
        }
      } else {
        const nextText = target.nextSibling
        if (nextText && nextText.nodeType === Node.TEXT_NODE) {
          newRange.setStart(nextText, 1)
        } else {
          newRange.setStartAfter(target)
        }
      }
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
      editorRef.current?.focus()
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('tep-chip')) {
      e.preventDefault()
      handleClick(e)
    }
  }, [handleClick])

  return (
    <div className="tep-root">
      <div
        ref={editorRef}
        className={`tep-editor ${className}`}
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
