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
import AuthGate from './AuthGate'
import App from './App'
import { installTimelineAxisRuntime } from './timelineAxisRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'
import { installAirportScopeRuntime } from './airportScopeRuntime'
import { installOnlinePresenceRuntime } from './onlinePresenceRuntime'
import { installReconnectTrafficFetch, installReconnectUiRuntime } from './reconnectRecovery'
import { installSystemPanelRuntime } from './systemPanelRuntime'
import { installSharedAmanRuntime } from './sharedAmanRuntime'
import { installOperationalAdvisoryRuntime } from './operationalAdvisoryRuntime'
import { installInteractionGuardRuntime } from './interactionGuardRuntime'

installReconnectTrafficFetch()

function AppWithRuntime() {
  useEffect(() => {
    const removeTimelineRuntime = installTimelineAxisRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
    const removeAirportScopeRuntime = installAirportScopeRuntime()
    const removeReconnectUiRuntime = installReconnectUiRuntime()
    const removeOnlinePresenceRuntime = installOnlinePresenceRuntime()
    const removeSystemPanelRuntime = installSystemPanelRuntime()
    const removeSharedAmanRuntime = installSharedAmanRuntime()
    const removeOperationalAdvisoryRuntime = installOperationalAdvisoryRuntime()
    const removeInteractionGuardRuntime = installInteractionGuardRuntime()
    return () => {
      removeTimelineRuntime()
      removeFlightStatusRuntime()
      removeAirportScopeRuntime()
      removeReconnectUiRuntime()
      removeOnlinePresenceRuntime()
      removeSystemPanelRuntime()
      removeSharedAmanRuntime()
      removeOperationalAdvisoryRuntime()
      removeInteractionGuardRuntime()
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
