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
import AuthGate from './AuthGate'
import App from './AppMaestroV24'
import { installTimelineAxisRuntime } from './timelineAxisRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'
import { installAirportScopeRuntime } from './airportScopeRuntime'
import { installOnlinePresenceRuntime } from './onlinePresenceRuntime'
import { installReconnectTrafficFetch, installReconnectUiRuntime } from './reconnectRecovery'
import { installSystemPanelRuntime } from './systemPanelRuntime'
import { installSharedAmanRuntime } from './sharedAmanRuntime'
import { installOperationalAdvisoryRuntime } from './operationalAdvisoryRuntime'
import { installInteractionGuardRuntime } from './interactionGuardRuntime'
import { installMaestroV24CompatRuntime } from './maestroV24CompatRuntime'

installReconnectTrafficFetch()

function AppWithRuntime() {
  useEffect(() => {
    // Compatibility decorator runs before the legacy lifecycle/advisory runtimes so
    // ETA-FF-labelled rows still expose the historical Predicted IAWP token they parse.
    const removeMaestroV24CompatRuntime = installMaestroV24CompatRuntime()
    const removeTimelineRuntime = installTimelineAxisRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
    const removeAirportScopeRuntime = installAirportScopeRuntime()
    const removeReconnectUiRuntime = installReconnectUiRuntime()
    const removeOnlinePresenceRuntime = installOnlinePresenceRuntime()
    const removeSystemPanelRuntime = installSystemPanelRuntime()
    const removeInteractionGuardRuntime = installInteractionGuardRuntime()
    const removeSharedAmanRuntime = installSharedAmanRuntime()
    const removeOperationalAdvisoryRuntime = installOperationalAdvisoryRuntime()
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
      removeOperationalAdvisoryRuntime()
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
