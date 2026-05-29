import { Buffer } from 'buffer'
window.Buffer = Buffer
globalThis.Buffer = Buffer
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {}, browser: true, version: '', versions: {} }
}
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
