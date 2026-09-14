import ivaoThailandLogo from './assets/ivao-thailand-logo.png'
import './login.css'

export default function LoginLanding({ loading, error }: { loading: boolean; error: string | null }) {
  return (
    <main className="auth-page auth-landing">
      <div className="login-layout">
        <section className="login-brand-panel" aria-labelledby="login-title">
          <svg className="login-logo" viewBox="1800 820 5900 2050" role="img" aria-label="IVAO Thailand" focusable="false">
            {/* Frame the original artwork; its transparent margins must not shrink the logo. */}
            <image href={ivaoThailandLogo} width="10005" height="3713" />
          </svg>
          <p className="login-eyebrow">THAILAND APPROACH AMAN</p>
          <h1 id="login-title">Arrival<br /><span>Sequencing</span></h1>
          <p className="login-intro">A shared workspace for coordinated arrivals.</p>
          <ul className="login-airports" aria-label="Supported airports">
            <li>VTBD</li><li>VTBS</li><li>VTCC</li><li>VTSP</li>
          </ul>
        </section>
        <section className="login-card" aria-labelledby="login-card-title" aria-busy={loading}>
          <div className="login-card-heading">
            <span className="login-card-kicker">CONTROLLER WORKSPACE</span>
            <h2 id="login-card-title">Sign in to AMAN</h2>
            <p>Continue with your IVAO account.</p>
          </div>
          {loading ? (
            <div className="login-session-status" role="status"><span className="login-spinner" aria-hidden="true" />Checking IVAO session…</div>
          ) : (
            <>
              {error && <div className="login-error" role="alert"><strong>Unable to continue</strong><p>{error}</p></div>}
              <a className="auth-login-button login-primary" href="/api/auth/login"><span>Sign in with IVAO</span><span aria-hidden="true">↗</span></a>
              <p className="login-provider-note">You’ll be redirected to IVAO to sign in.<br />Your password stays with IVAO.</p>
              {error && <button type="button" className="login-retry" onClick={() => window.location.reload()}>Try session check again</button>}
            </>
          )}
          <div className="login-access-note"><span>ABOUT AMAN</span><p>A shared arrival-sequencing workspace for the IVAO simulation network. Sign in with your IVAO account to continue.</p></div>
        </section>
        <footer className="login-footer"><span>IVAO THAILAND</span><span>For flight simulation only</span></footer>
      </div>
    </main>
  )
}
