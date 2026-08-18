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
import AuthGate from './AuthGate'
import App from './App'
import { installTimelineAxisRuntime } from './timelineAxisRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'
import { installAirportScopeRuntime } from './airportScopeRuntime'
import { installRunwayAssignmentRuntime } from './runwayAssignmentRuntime'

function AppWithRuntime() {
  useEffect(() => {
    const removeTimelineRuntime = installTimelineAxisRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
    const removeAirportScopeRuntime = installAirportScopeRuntime()
    const removeRunwayAssignmentRuntime = installRunwayAssignmentRuntime()
    return () => {
      removeTimelineRuntime()
      removeFlightStatusRuntime()
      removeAirportScopeRuntime()
      removeRunwayAssignmentRuntime()
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
