import { useState } from 'react'
import TemplateEditor from './components/TemplateEditor'
import type { Placeholder } from './components/TemplateEditor'
import './components/TemplateEditor.css'
import './App.css'

const placeholders: Placeholder[] = [
  { id: 'User', label: 'User', required: true },
  { id: 'OrderId', label: 'Order ID', required: true },
  { id: 'StoreName', label: 'Store Name', required: false },
  { id: 'DiscountCode', label: 'Discount Code', required: false },
  { id: 'ExpiryDate', label: 'Expiry Date', required: false },
]

function App() {
  const [value, setValue] = useState('Hi {User},\n\nYour order {OrderId} is confirmed.\n\nThanks,\n{StoreName}')
  const [saved, setSaved] = useState('')

  const missing = placeholders
    .filter(ph => ph.required && !value.includes(`{${ph.id}}`))
    .map(ph => ph.label)

  const handleSave = () => {
    if (missing.length > 0) return
    setSaved(value)
  }

  return (
    <div className="app">
      <h1>Template Editor</h1>
      <p className="desc">
        Type <code>{'{'}</code> to insert a placeholder. Required placeholders (red) cannot be deleted
        — only cut. Paste <code>{'{User}'}</code>-style text to auto-convert.
      </p>

      <TemplateEditor
        value={value}
        onChange={setValue}
        placeholders={placeholders}
        placeholder="Type your template here..."
        minHeight="180px"
      />

      <div className="toolbar">
        <div className="status">
          {missing.length > 0 ? (
            <span className="error">Missing required placeholders: {missing.join(', ')}</span>
          ) : (
            <span className="ok">All required placeholders present</span>
          )}
        </div>
        <button onClick={handleSave} disabled={missing.length > 0}>
          Save
        </button>
      </div>

      <div className="raw">
        <strong>Value:</strong>
        <pre>{value}</pre>
      </div>

      {saved && (
        <div className="saved">
          <strong>Saved template:</strong>
          <pre>{saved}</pre>
        </div>
      )}
    </div>
  )
}

export default App
