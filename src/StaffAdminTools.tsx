import { useCallback, useEffect, useState } from 'react'
import { useAuthUser } from './AuthGate'
import './staffAdminTools.css'
import './sessionAudit.css'

type LoginAuditEvent = {
  id: number
  vid: string
  name: string
  public_nickname: string | null
  role: 'MEMBER' | 'STAFF'
  is_thailand_staff: boolean
  staff_positions: string[]
  division_id: string | null
  country_id: string | null
  atc_rating: string | null
  pilot_rating: string | null
  logged_in_at: string
  session_id: string | null
  last_activity_at: string | null
  expires_at: string | null
  logged_out_at: string | null
  end_reason: 'SIGN_OUT' | 'IDLE' | 'EXPIRED' | null
}

type LoginAuditPayload = {
  days: number
  limit: number
  eventCount: number
  uniqueVids: number
  activeCount: number
  events: LoginAuditEvent[]
  error?: string
}

function utcTimestamp(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19).replace('T', ' ')}Z` : 'INVALID'
}

function bangkokTimestamp(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'INVALID'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(',', '')
}

function sessionStatus(event: LoginAuditEvent) {
  if (event.end_reason) return event.end_reason
  if (!event.session_id) return 'LEGACY'
  const now = Date.now()
  if (new Date(event.expires_at || '').getTime() <= now) return 'EXPIRED'
  if (new Date(event.last_activity_at || event.logged_in_at).getTime() + 2 * 60 * 60 * 1000 <= now) return 'IDLE'
  return 'ACTIVE'
}

export default function StaffAdminTools() {
  const user = useAuthUser()
  const [auditDays, setAuditDays] = useState(7)
  const [audit, setAudit] = useState<LoginAuditPayload | null>(null)
  const [auditError, setAuditError] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)

  const loadAudit = useCallback(async () => {
    if (!user.isThailandStaff) return
    setAuditLoading(true)
    setAuditError('')
    try {
      const response = await fetch(`/api/admin/login-audit?days=${auditDays}&limit=500`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json() as LoginAuditPayload
      if (!response.ok) throw new Error(payload.error || `Login audit API returned ${response.status}`)
      setAudit(payload)
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : String(error))
    } finally {
      setAuditLoading(false)
    }
  }, [auditDays, user.isThailandStaff])

  useEffect(() => { void loadAudit() }, [loadAudit])

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

        <a className="stafftools-card is-ready" href="/?admin=caat">
          <div className="stafftools-card-head"><span>CAAT</span><b>READY</b></div>
          <h2>CAAT eAIP Import</h2>
          <p>Scan the effective CAAT AIRAC, review mapped STAR records and explicitly approve selected changes into audited master data.</p>
          <small>CAAT eAIP scanner · staff review · approval audit</small>
        </a>

        <a className="stafftools-card is-ready" href="#login-audit">
          <div className="stafftools-card-head"><span>AUDIT</span><b>LIVE</b></div>
          <h2>IVAO Login History</h2>
          <p>Staff-only history of successful IVAO sign-ins and how each session ended.</p>
          <small>Login · activity · sign-out reason · IVAO identity</small>
        </a>
      </section>

      <section className="stafftools-audit" id="login-audit">
        <header>
          <div><span>SECURITY AUDIT</span><h2>IVAO Session History</h2><p>Times are shown in Bangkok local time and UTC. Closing a browser tab alone does not end a session.</p></div>
          <div className="stafftools-audit-controls">
            <label><span>Range</span><select value={auditDays} onChange={(event) => setAuditDays(Number(event.target.value))}><option value={1}>24 HOURS</option><option value={7}>7 DAYS</option><option value={30}>30 DAYS</option><option value={90}>90 DAYS</option></select></label>
            <button type="button" onClick={() => void loadAudit()} disabled={auditLoading}>{auditLoading ? 'LOADING…' : 'REFRESH'}</button>
          </div>
        </header>

        <div className="stafftools-audit-summary">
          <div><span>LOGIN EVENTS</span><strong>{audit?.eventCount ?? '---'}</strong></div>
          <div><span>UNIQUE VIDS</span><strong>{audit?.uniqueVids ?? '---'}</strong></div>
          <div><span>ACTIVE NOW</span><strong>{audit?.activeCount ?? '---'}</strong></div>
          <div><span>WINDOW</span><strong>{audit?.days ?? auditDays}D</strong></div>
        </div>

        {auditError && <div className="stafftools-audit-error">{auditError}</div>}
        <div className="stafftools-audit-table-wrap">
          <table className="stafftools-audit-table">
            <thead><tr><th>LOGIN BANGKOK (UTC+7)</th><th>LOGIN UTC</th><th>NAME</th><th>VID</th><th>ROLE</th><th>SESSION</th><th>ENDED BANGKOK</th><th>POSITION / RATING</th></tr></thead>
            <tbody>
              {(audit?.events || []).map((event) => <tr key={event.id}>
                <td>{bangkokTimestamp(event.logged_in_at)}</td>
                <td>{utcTimestamp(event.logged_in_at)}</td>
                <td><strong>{event.name}</strong>{event.public_nickname && event.public_nickname !== event.name ? <small>{event.public_nickname}</small> : null}</td>
                <td>{event.vid}</td>
                <td><b className={event.is_thailand_staff ? 'is-staff' : ''}>{event.role}</b></td>
                <td><b className={`session-${sessionStatus(event).toLowerCase()}`}>{sessionStatus(event)}</b></td>
                <td>{event.logged_out_at ? bangkokTimestamp(event.logged_out_at) : '—'}</td>
                <td>{event.staff_positions?.length ? event.staff_positions.join(' / ') : [event.atc_rating, event.pilot_rating].filter(Boolean).join(' / ') || '—'}</td>
              </tr>)}
              {!auditLoading && audit && audit.events.length === 0 ? <tr><td colSpan={8} className="empty">No successful login events in this window.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {audit && audit.eventCount === audit.limit ? <small className="stafftools-audit-limit">Showing the newest {audit.limit} events. Select a shorter range for a complete view.</small> : null}
      </section>
    </main>
  </div>
}
