import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './polish.css'
import { installSpreadsheetNavigation } from './spreadsheetNavigation'
import App from './App'

installSpreadsheetNavigation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
