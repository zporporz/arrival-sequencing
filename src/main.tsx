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
import './reactNavbar.css'
import './adminEditors.css'
import './sessionAdmin.css'
import { installSpreadsheetNavigation } from './spreadsheetNavigation'
import { installSpacingGuard } from './spacingGuard'
import { installFieldGuide } from './fieldGuide'
import { installTimeWorkflow } from './timeWorkflow'
import { installLifecyclePanel } from './lifecyclePanel'
import { installAuditIdentity } from './auditIdentity'
import { installRestoreCancelled } from './restoreCancelled'
import AuthGate from './AuthGate'
import AdminPanel from './AdminPanelV2'
import App from './App'

installAuditIdentity()
installSpreadsheetNavigation()
installSpacingGuard()
installFieldGuide()
installTimeWorkflow()
installLifecyclePanel()
installRestoreCancelled()

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {isAdminRoute ? <AdminPanel /> : <App />}
    </AuthGate>
  </StrictMode>,
)
