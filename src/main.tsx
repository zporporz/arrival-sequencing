import { StrictMode, useEffect } from 'react'
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
import './maestroOpsMenuRuntime.css'
import './landedHistoryRuntime.css'
import AuthGate from './AuthGate'
import App from './AppMaestroV24'
import { installTimelineScrollableRuntime } from './timelineScrollableRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'
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

installReconnectTrafficFetch()

function AppWithRuntime() {
  useEffect(() => {
    const removeMaestroV24CompatRuntime = installMaestroV24CompatRuntime()
    const removeTimelineRuntime = installTimelineScrollableRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
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

    const removeOperationalAdvisoryRuntime = installOperationalAdvisoryRuntime()
    const removeTimelineReadableRuntime = installTimelineReadableRuntime()
    return () => {
      removeMaestroV24CompatRuntime()
      removeTimelineRuntime()
      removeFlightStatusRuntime()
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
      removeOperationalAdvisoryRuntime()
      removeTimelineReadableRuntime()
    }
  }, [])

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <AppWithRuntime />
    </AuthGate>
  </StrictMode>,
)
