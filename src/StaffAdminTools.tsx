import { useAuthUser } from './AuthGate'

export default function StaffAdminTools() {
  const user = useAuthUser()

  if (!user.isThailandStaff) {
    return <main className="stafftools-denied"><strong>STAFF ACCESS REQUIRED</strong><span>Thailand Division staff only.</span><a href="/">Return to AMAN</a></main>
  }

  return <div className="stafftools-app">
    <header className="stafftools-topbar">
      <div><span>IVAO THAILAND · STAFF</span><strong>AMAN ADMIN TOOLS</strong></div>
      <nav><a href="/">← AMAN</a><span>{user.name} · {user.vid}</span><a href="/api/auth/logout">Sign out</a></nav>
    </header>

    <main className="stafftools-main">
      <section className="stafftools-hero">
        <span>STAFF CONTROL</span>
        <h1>Admin Tools</h1>
        <p>Operational support tools for Thailand Division staff. Production AMAN remains separate from staged configuration and AIRAC changes.</p>
      </section>

      <section className="stafftools-grid">
        <a className="stafftools-card is-ready" href="/?admin=navdata">
          <div className="stafftools-card-head"><span>NAVDATA</span><b>READY</b></div>
          <h2>AIRAC / Navdata</h2>
          <p>Import Little Navmap SQLite, review VTBD/VTBS STAR legs and constraints, compare AIRAC revisions, activate or roll back a cycle.</p>
          <small>Little Navmap SQLite · STAR · ALT/SPD · AIRAC history</small>
        </a>

        <a className="stafftools-card is-ready" href="/?admin=master">
          <div className="stafftools-card-head"><span>MASTER DATA</span><b>READY</b></div>
          <h2>Airport / Runway / Timing</h2>
          <p>Edit airport records, runway-flow configuration and nominal fix-to-landing timings through the existing staff-only admin API.</p>
          <small>Airport · Runway flow · Fix timing · Supabase audit</small>
        </a>

        <article className="stafftools-card">
          <div className="stafftools-card-head"><span>CAAT</span><b>BACKEND</b></div>
          <h2>CAAT eAIP Import</h2>
          <p>Existing staff backend can scan CAAT AIRAC issues and STAR references. This remains a secondary official-source cross-check beside structured navdata.</p>
          <small>CAAT eAIP scanner · review workflow pending</small>
        </article>

        <article className="stafftools-card">
          <div className="stafftools-card-head"><span>AUDIT</span><b>PLANNED</b></div>
          <h2>System / Change History</h2>
          <p>Consolidated staff audit for AIRAC activation, configuration edits, rollback activity and system health.</p>
          <small>Will combine existing history sources</small>
        </article>
      </section>
    </main>
  </div>
}
