import { lazy, StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import './live.css'
import './drag.css'
import './timelineWindow.css'
import './timelineAxisRuntime.css'
import './flightStatus.css'
import './multiRunway.css'
import './controlReadability.css'
import './airportPickerFix.css'
import './runwayAssignment.css'
import './compactControlStrip.css'
import './operationalReadability.css'
import './finalControlLayout.css'
import './runtimeEnhancements.css'
import './systemPanelRuntime.css'
import './sharedAmanRuntime.css'
import './operationalAdvisory.css'
import './callsignState.css'
import './planningProtection.css'
import './operationalHmiReadable.css'
import './maestroV24.css'
import './timelineCompactRows.css'
import './timelineScrollable.css'
import './maestroTimelineAxis.css'
import './maestroTimelineTicks.css'
import './maestroOpsMenuRuntime.css'
import './landedHistoryRuntime.css'
import './staffNavdataLinkRuntime.css'
import AuthGate, { useAuthUser } from './AuthGate'
import App from './AppMaestroV24'
import { installTimelineScrollableRuntime } from './timelineScrollableRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'
import { installEtaFfLifecycleRuntime } from './etaFfLifecycleRuntime'
import { installFinalTenNmRuntime } from './finalTenNmRuntime'
import { installTestTrafficIsolationRuntime } from './testTrafficIsolationRuntime'
import { installAirportScopeRuntime } from './airportScopeRuntime'
import { installOnlinePresenceRuntime } from './onlinePresenceRuntime'
import { installReconnectTrafficFetch, installReconnectUiRuntime } from './reconnectRecovery'
import { installSystemPanelRuntime } from './systemPanelRuntime'
import { installSharedAmanRuntime } from './sharedAmanRuntime'
import { installOperationalAdvisoryRuntime } from './operationalAdvisoryRuntime'
import { installInteractionGuardRuntime } from './interactionGuardRuntime'
import { installMaestroV24CompatRuntime } from './maestroV24CompatRuntime'
import { installManualSequenceReorderRuntime } from './manualSequenceReorderRuntime'
import { installTimelineReadableRuntime } from './timelineReadableRuntime'
import { installTimelineDisplayScaleRuntime } from './timelineDisplayScaleRuntime'
import { installManualTargetSyncCompatRuntime } from './manualTargetSyncCompatRuntime'
import { installKnownInboundAdmissionRuntime } from './knownInboundAdmissionRuntime'
import { installMonitoredTimelineRuntime } from './monitoredTimelineRuntime'
import { installMaestroOpsMenuRuntime } from './maestroOpsMenuRuntime'
import { installLandedHistoryRuntime } from './landedHistoryRuntime'
import { installVtbdCapacityRuntime } from './vtbdCapacityRuntime'
import { installStaffNavdataLinkRuntime } from './staffNavdataLinkRuntime'
import { installMissedApproachDirectInsertRuntime } from './missedApproachDirectInsertRuntime'

const StaffNavdataAdminPage = lazy(() => import('./StaffNavdataAdminPage'))
const StaffMasterDataAdmin = lazy(() => import('./StaffMasterDataAdmin'))
const StaffAdminTools = lazy(() => import('./StaffAdminTools'))

installReconnectTrafficFetch()

function adminRoute() {
  return new URLSearchParams(window.location.search).get('admin')
}

function AppWithRuntime() {
  const user = useAuthUser()

  useEffect(() => {
    // Install isolation first so synthetic TEST TRAFFIC can exercise the same local
    // handlers without writing fake callsigns into production shared flight state.
    const removeTestTrafficIsolationRuntime = installTestTrafficIsolationRuntime()
    const removeMaestroV24CompatRuntime = installMaestroV24CompatRuntime()
    const removeTimelineRuntime = installTimelineScrollableRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
    const removeFinalTenNmRuntime = installFinalTenNmRuntime()
    const removeEtaFfLifecycleRuntime = installEtaFfLifecycleRuntime()
    const removeAirportScopeRuntime = installAirportScopeRuntime()
    const removeReconnectUiRuntime = installReconnectUiRuntime()
    const removeOnlinePresenceRuntime = installOnlinePresenceRuntime()
    const removeSystemPanelRuntime = installSystemPanelRuntime()
    const removeInteractionGuardRuntime = installInteractionGuardRuntime()
    const removeSharedAmanRuntime = installSharedAmanRuntime()
    const removeManualSequenceReorderRuntime = installManualSequenceReorderRuntime()
    const removeTimelineDisplayScaleRuntime = installTimelineDisplayScaleRuntime()
    const removeManualTargetSyncCompatRuntime = installManualTargetSyncCompatRuntime()
    const removeKnownInboundAdmissionRuntime = installKnownInboundAdmissionRuntime()
    const removeMonitoredTimelineRuntime = installMonitoredTimelineRuntime()
    const removeMaestroOpsMenuRuntime = installMaestroOpsMenuRuntime()
    const removeLandedHistoryRuntime = installLandedHistoryRuntime()
    const removeVtbdCapacityRuntime = installVtbdCapacityRuntime()
    const removeStaffNavdataLinkRuntime = user.isThailandStaff
      ? installStaffNavdataLinkRuntime()
      : () => {}
    const removeOperationalAdvisoryRuntime = installOperationalAdvisoryRuntime()
    const removeTimelineReadableRuntime = installTimelineReadableRuntime()
    const removeMissedApproachDirectInsertRuntime = installMissedApproachDirectInsertRuntime()

    return () => {
      removeMaestroV24CompatRuntime()
      removeTimelineRuntime()
      removeFlightStatusRuntime()
      removeFinalTenNmRuntime()
      removeEtaFfLifecycleRuntime()
      removeAirportScopeRuntime()
      removeReconnectUiRuntime()
      removeOnlinePresenceRuntime()
      removeSystemPanelRuntime()
      removeInteractionGuardRuntime()
      removeSharedAmanRuntime()
      removeManualSequenceReorderRuntime()
      removeTimelineDisplayScaleRuntime()
      removeManualTargetSyncCompatRuntime()
      removeKnownInboundAdmissionRuntime()
      removeMonitoredTimelineRuntime()
      removeMaestroOpsMenuRuntime()
      removeLandedHistoryRuntime()
      removeVtbdCapacityRuntime()
      removeStaffNavdataLinkRuntime()
      removeOperationalAdvisoryRuntime()
      removeTimelineReadableRuntime()
      removeMissedApproachDirectInsertRuntime()
      removeTestTrafficIsolationRuntime()
    }
  }, [user.isThailandStaff])

  return <App />
}

function RootApp() {
  const route = adminRoute()
  if (route === 'navdata') return <StaffNavdataAdminPage />
  if (route === 'master') return <StaffMasterDataAdmin />
  if (route === 'tools') return <StaffAdminTools />
  return <AppWithRuntime />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <Suspense fallback={<main className="auth-screen"><p>Loading module…</p></main>}>
        <RootApp />
      </Suspense>
    </AuthGate>
  </StrictMode>,
)
