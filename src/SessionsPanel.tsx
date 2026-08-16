import { useEffect, useMemo, useState } from 'react'

type SequenceSession = {
  id: string
  airport: string
  flow: string
  runway_config: string | null
  service_date: string
  status: string
  archived?: boolean
  closed_at?: string | null
  created_at: string
}

type ArrivalHistory = {
  id: string
  sequence_no: number
  callsign: string
  aircraft_type: string
  departure: string
  ref_fix: string
  eto: string
  eldt: string
  cldt: string
  cto: string
  aldt: string | null
  status: string
  nominal_seconds_snapshot: number
  est_var: string | null
  seq_var: string | null
}

type Props = {
  sessions: SequenceSession[]
  onChanged?: () => Promise<void>
}

function fmtTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', { hour12: false, timeZone: 'UTC' }) + ' UTC'
}

async function loadSession(id: string) {
  const response = await fetch(`/api/admin/session?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' })
  const payload = await response.json() as { session?: SequenceSession; arrivals?: ArrivalHistory[]; error?: string }
  if (!response.ok || !payload.session) throw new Error(payload.error || 'Unable to load session')
  return { session: payload.session, arrivals: payload.arrivals ?? [] }
}

async function changeSession(id: string, sessionAction: 'close' | 'reopen' | 'archive' | 'restore') {
  const response = await fetch('/api/admin/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, sessionAction }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || 'Unable to update session')
}

export default function SessionsPanel({ sessions, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<{ session: SequenceSession; arrivals: ArrivalHistory[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const visibleSessions = useMemo(() => sessions.filter((item) => showArchived || !item.archived), [sessions, showArchived])

  useEffect(() => {
    if (!visibleSessions.length) {
      setSelectedId('')
      setDetail(null)
      return
    }
    if (!visibleSessions.some((item) => item.id === selectedId)) setSelectedId(visibleSessions[0].id)
  }, [visibleSessions, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadSession(selectedId)
      .then((payload) => { if (!cancelled) setDetail(payload) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const runAction = async (action: 'close' | 'reopen' | 'archive' | 'restore') => {
    if (!detail) return
    const label = action === 'close' ? 'Close' : action === 'reopen' ? 'Reopen' : action === 'archive' ? 'Archive' : 'Restore'
    if (!window.confirm(`${label} session ${detail.session.service_date} · ${detail.session.airport} ${detail.session.runway_config ?? ''}?`)) return
    setSaving(true)
    setError(null)
    try {
      await changeSession(detail.session.id, action)
      if (onChanged) await onChanged()
      const refreshed = await loadSession(detail.session.id)
      setDetail(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="session-admin-grid">
      <div className="admin-card session-list-card">
        <div className="admin-card-heading">
          <div><span className="admin-label">SESSIONS</span><h2>Sequence history</h2><p>Open a session to inspect the traffic that used that workspace.</p></div>
          <label className="session-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>Show archived</span></label>
        </div>
        <div className="session-list">
          {visibleSessions.length === 0 ? <div className="admin-empty">No sessions.</div> : visibleSessions.map((session) => (
            <button key={session.id} className={`session-list-row ${selectedId === session.id ? 'selected' : ''}`} onClick={() => setSelectedId(session.id)}>
              <div><strong>{session.service_date}</strong><span>{session.airport} · {session.runway_config ?? `flow ${session.flow}`}</span></div>
              <div className="session-list-state"><span className={`session-state ${session.archived ? 'archived' : session.status.toLowerCase()}`}>{session.archived ? 'ARCHIVED' : session.status}</span><small>{fmtTime(session.created_at)}</small></div>
            </button>
          ))}
        </div>
      </div>

      <div className="admin-card session-detail-card">
        {!selectedId ? <div className="admin-empty">Select a session.</div> : loading ? <div className="admin-loading">Loading session traffic…</div> : error ? <div className="admin-error session-error"><strong>Session:</strong> {error}</div> : detail ? <>
          <div className="admin-card-heading session-detail-heading">
            <div><span className="admin-label">{detail.session.airport} · FLOW {detail.session.flow}</span><h2>{detail.session.service_date} · {detail.session.runway_config ?? 'No runway label'}</h2><p>{detail.arrivals.length} arrival{detail.arrivals.length === 1 ? '' : 's'} · Created {fmtDateTime(detail.session.created_at)}{detail.session.closed_at ? ` · Closed ${fmtDateTime(detail.session.closed_at)}` : ''}</p></div>
            <div className="session-actions">
              {!detail.session.archived && (detail.session.status === 'ACTIVE' ? <button onClick={() => void runAction('close')} disabled={saving}>Close session</button> : <button className="restore-soft" onClick={() => void runAction('reopen')} disabled={saving}>Reopen</button>)}
              <button className={detail.session.archived ? 'restore-soft' : 'danger-soft'} onClick={() => void runAction(detail.session.archived ? 'restore' : 'archive')} disabled={saving}>{detail.session.archived ? 'Restore session' : 'Archive'}</button>
            </div>
          </div>

          <div className="session-summary-strip">
            <div><span>STATUS</span><strong>{detail.session.archived ? 'ARCHIVED' : detail.session.status}</strong></div>
            <div><span>ARRIVALS</span><strong>{detail.arrivals.length}</strong></div>
            <div><span>LANDED</span><strong>{detail.arrivals.filter((item) => item.aldt).length}</strong></div>
            <div><span>CANCELLED</span><strong>{detail.arrivals.filter((item) => item.status === 'CANCELLED').length}</strong></div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table session-arrival-table">
              <thead><tr><th>SEQ</th><th>CALLSIGN</th><th>A/C</th><th>DEP</th><th>REF FIX</th><th>ETO</th><th>ELDT</th><th>CLDT</th><th>CTO</th><th>ALDT</th><th>STATUS</th></tr></thead>
              <tbody>
                {detail.arrivals.length === 0 ? <tr><td colSpan={11} className="admin-empty-cell">No arrivals were stored in this session.</td></tr> : detail.arrivals.map((arrival) => <tr key={arrival.id}><td>{arrival.sequence_no}</td><td><strong>{arrival.callsign}</strong></td><td>{arrival.aircraft_type}</td><td>{arrival.departure}</td><td>{arrival.ref_fix}</td><td>{fmtTime(arrival.eto)}</td><td>{fmtTime(arrival.eldt)}</td><td>{fmtTime(arrival.cldt)}</td><td>{fmtTime(arrival.cto)}</td><td>{fmtTime(arrival.aldt)}</td><td><span className={`session-flight-status ${arrival.status.toLowerCase()}`}>{arrival.status}</span></td></tr>)}
              </tbody>
            </table>
          </div>
        </> : null}
      </div>
    </section>
  )
}
