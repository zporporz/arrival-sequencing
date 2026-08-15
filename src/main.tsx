import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './polish.css'
import './production.css'
import './readability.css'
import './warning.css'
import './timeWorkflow.css'
import { installSpreadsheetNavigation } from './spreadsheetNavigation'
import { installSpacingGuard } from './spacingGuard'
import { installFieldGuide } from './fieldGuide'
import { installTimeWorkflow } from './timeWorkflow'
import App from './App'

installSpreadsheetNavigation()
installSpacingGuard()
installFieldGuide()
installTimeWorkflow()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
