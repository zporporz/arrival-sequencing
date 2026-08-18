import { useAuthUser } from './AuthGate'

export default function App() {
  const user = useAuthUser()

  return (
    <div className="construction-app">
      <header className="construction-topbar">
        <div className="construction-brand">
          <small>Thailand Approach Tools</small>
          <strong>Arrival Sequencing</strong>
        </div>

        <div className="construction-account">
          <div className="construction-account-copy">
            <strong>{user.name}</strong>
            <span>VID {user.vid}</span>
          </div>
          <a className="construction-signout" href="/api/auth/logout">Sign out</a>
        </div>
      </header>

      <main className="construction-main">
        <div className="construction-beacon" aria-hidden="true" />
        <p className="construction-kicker">Approach AMAN rebuild</p>
        <h1>UNDER<br />CONSTRUCTION</h1>
        <p className="construction-copy">
          The previous interface has been retired. A new MAESTRO-style arrival sequencing system is being built from a clean baseline.
        </p>
        <div className="construction-status">
          <span />
          Core API, IVAO data access and sequencing research are preserved.
        </div>
      </main>
    </div>
  )
}
