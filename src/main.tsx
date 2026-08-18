import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import './live.css'
import AuthGate from './AuthGate'
import App from './App'
import ivaoThailandLogo from './assets/ivao-thailand-logo.png'

function ArrivalSequencingApp() {
  useEffect(() => {
    const logo = document.querySelector<HTMLImageElement>('.aman-brand img')
    if (logo) logo.src = ivaoThailandLogo
  }, [])

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <ArrivalSequencingApp />
    </AuthGate>
  </StrictMode>,
)
