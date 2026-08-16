import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './polish.css'
import './production.css'
import './readability.css'
import './warning.css'
import './timeWorkflow.css'
import './flowSelector.css'
import './workflowControls.css'
import './lifecyclePanel.css'
import './restoreCancelled.css'
import './auth.css'
import { installSpreadsheetNavigation } from './spreadsheetNavigation'
import { installSpacingGuard } from './spacingGuard'
import { installFieldGuide } from './fieldGuide'
import { installTimeWorkflow } from './timeWorkflow'
import { installFlowSelector } from './flowSelector'
import { installLifecyclePanel } from './lifecyclePanel'
import { installAuditIdentity } from './auditIdentity'
import { installRestoreCancelled } from './restoreCancelled'
import { installAuthTopbar } from './authTopbar'
import AuthGate from './AuthGate'
import App from './App'

installAuditIdentity()
installSpreadsheetNavigation()
installSpacingGuard()
installFieldGuide()
installTimeWorkflow()
installFlowSelector()
installLifecyclePanel()
installRestoreCancelled()
installAuthTopbar()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
