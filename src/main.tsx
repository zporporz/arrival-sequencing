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
import './amanV2.css'
import { installSpreadsheetNavigation } from './spreadsheetNavigation'
import { installSpacingGuard } from './spacingGuard'
import { installFieldGuide } from './fieldGuide'
import { installTimeWorkflow } from './timeWorkflow'
import { installLifecyclePanel } from './lifecyclePanel'
import { installRestoreCancelled } from './restoreCancelled'
import AuthGate from './AuthGate'
import AdminPanel from './AdminPanelV2'
import AmanShell from './AmanShell'
import App from './App'

// Deployment marker: AMAN V2 is the default live interface.
installSpreadsheetNavigation()
installSpacingGuard()
installFieldGuide()
installTimeWorkflow()
installLifecyclePanel()
installRestoreCancelled()

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
const useLegacyEditor = new URLSearchParams(window.location.search).get('legacy') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {isAdminRoute ? <AdminPanel /> : useLegacyEditor ? <App /> : <AmanShell />}
    </AuthGate>
  </StrictMode>,
)
