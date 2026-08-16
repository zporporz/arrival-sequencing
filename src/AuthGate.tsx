import { useEffect, useState, type ReactNode } from 'react'
import { setAuthenticatedVid } from './browserIdentity'

export type AuthUser = {
  id: number | string
  vid: string
  name: string
  publicNickname: string | null
  divisionId: string | null
  countryId: string | null
  atcRating: string | null
  pilotRating: string | null
  isIvaoStaff: boolean
  isThailandStaff: boolean
  role: 'MEMBER' | 'STAFF'
  staffPositions: string[]
  createdAt: string
}

type AuthResponse = {
  authenticated: boolean
  user?: AuthUser
}

function loginMessage() {
  const reason = new URLSearchParams(window.location.search).get('login')
  if (!reason || reason === 'success') return null
  if (reason === 'token_failed') return 'IVAO sign-in could not exchange the authorization code. Please try again.'
  if (reason === 'user_failed') return 'IVAO sign-in succeeded, but the profile could not be loaded. Please try again.'
  return 'IVAO sign-in was not completed. Please try again.'
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(loginMessage())

  useEffect(() => {
    let disposed = false

    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
        if (response.status === 401) {
          setAuthenticatedVid(null)
          if (!disposed) setUser(null)
          return
        }
        if (!response.ok) throw new Error(`Authentication service returned ${response.status}`)

        const payload = await response.json() as AuthResponse
        if (!payload.authenticated || !payload.user) {
          setAuthenticatedVid(null)
          if (!disposed) setUser(null)
          return
        }

        setAuthenticatedVid(payload.user.vid)
        document.documentElement.dataset.authRole = payload.user.role
        document.documentElement.dataset.authVid = payload.user.vid
        if (!disposed) setUser(payload.user)
      } catch (sessionError) {
        setAuthenticatedVid(null)
        if (!disposed) {
          setError(sessionError instanceof Error ? sessionError.message : String(sessionError))
          setUser(null)
        }
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void loadSession()
    return () => { disposed = true }
  }, [])

  if (loading) {
    return (
      <main className="auth-page">
        <section className="auth-card auth-loading-card">
          <div className="auth-spinner" />
          <strong>Checking IVAO session…</strong>
        </section>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-eyebrow">THAILAND APPROACH TOOLS</div>
          <h1>BKK TMA Arrival Sequencing</h1>
          <p className="auth-copy">Sign in with your IVAO account to open the shared arrival sequencing workspace.</p>
          {error && <div className="auth-error">{error}</div>}
          <a className="auth-login-button" href="/api/auth/login">Sign in with IVAO</a>
          <small>Thailand Division staff accounts are automatically granted staff access.</small>
        </section>
      </main>
    )
  }

  return (
    <div className="auth-root">
      {children}
      <div className="auth-session-chip" title={user.staffPositions.join(', ') || user.name}>
        {user.isThailandStaff && <span className="auth-staff-badge">TH STAFF</span>}
        <span className="auth-session-name">{user.vid}</span>
        <a href="/api/auth/logout">Sign out</a>
      </div>
    </div>
  )
}
