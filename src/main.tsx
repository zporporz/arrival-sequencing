import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import './live.css'
import './drag.css'
import './timelineWindow.css'
import './timelineAxisRuntime.css'
import './flightStatus.css'
import AuthGate from './AuthGate'
import App from './App'
import { installTimelineAxisRuntime } from './timelineAxisRuntime'
import { installFlightStatusRuntime } from './flightStatusRuntime'

function AppWithRuntime() {
  useEffect(() => {
    const removeTimelineRuntime = installTimelineAxisRuntime()
    const removeFlightStatusRuntime = installFlightStatusRuntime()
    return () => {
      removeTimelineRuntime()
      removeFlightStatusRuntime()
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
