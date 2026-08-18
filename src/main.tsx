import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import './live.css'
import './drag.css'
import './timelineWindow.css'
import './timelineAxisRuntime.css'
import AuthGate from './AuthGate'
import App from './App'
import { installTimelineAxisRuntime } from './timelineAxisRuntime'

function AppWithTimelineRuntime() {
  useEffect(() => installTimelineAxisRuntime(), [])
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <AppWithTimelineRuntime />
    </AuthGate>
  </StrictMode>,
)
