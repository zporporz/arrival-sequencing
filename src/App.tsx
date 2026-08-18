import { useEffect, useState } from 'react'
import { useAuthUser } from './AuthGate'
import { readWorkspaces, type WorkspacePayload } from './core/api'

export default function App() {
  const user = useAuthUser()
  const [workspaces, setWorkspaces] = useState<WorkspacePayload | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    void readWorkspaces()
      .then((payload) => {
        if (!disposed) {
          setWorkspaces(payload)
          setApiError(null)
        }
      })
      .catch((error) => {
        if (!disposed) setApiError(error instanceof Error ? error.message : String(error))
      })

    return () => { disposed = true }
  }, [])

  const apiReady = workspaces !== null && !apiError

  return (
    <div className="reset-app">
      <header className="reset-topbar">
        <div className="reset-brand">
          <small>Thailand Approach Tools</small>
          <strong>Arrival Sequencing</strong>
        </div>

        <div className="reset-account">
          <div className="reset-account-copy">
            <strong>{user.name}</strong>
            <span>VID {user.vid}</span>
          </div>
          <a className="reset-signout" href="/api/auth/logout">Sign out</a>
        </div>
      </header>

      <main className="reset-main">
        <section className="reset-hero">
          <span className="reset-kicker">Fresh frontend baseline</span>
          <h1>Frontend reset complete</h1>
          <p>
            The previous operational interface is no longer mounted. The React shell,
            IVAO authentication, API access layer and Supabase configuration remain available for the rebuild.
          </p>

          <div className="reset-status-grid">
            <article className="reset-status is-ok">
              <span>Authentication</span>
              <strong>IVAO connected</strong>
              <small>The existing /api/auth integration remains active.</small>
            </article>

            <article className={`reset-status ${apiReady ? 'is-ok' : apiError ? 'is-error' : ''}`}>
              <span>Server API</span>
              <strong>{apiReady ? 'Connected' : apiError ? 'Connection error' : 'Checking...'}</strong>
              <small>
                {apiReady
                  ? `${workspaces.airports.length} airports and ${workspaces.runwayConfigs.length} runway configs available`
                  : apiError || 'Reading /api/workspaces'}
              </small>
            </article>

            <article className="reset-status is-ok">
              <span>Data layer</span>
              <strong>Preserved</strong>
              <small>Supabase environment variables, client configuration and backend functions are unchanged.</small>
            </article>
          </div>

          <div className="reset-note">
            AMAN, sequence table, admin editor and previous workflow UI are not mounted in this baseline.
            The next interface can now be designed from a clean starting point.
          </div>
        </section>
      </main>
    </div>
  )
}
