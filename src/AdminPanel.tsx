import { useEffect, useMemo, useState } from 'react'
import { useAuthUser } from './AuthGate'
import TimingEditor, { type FixTiming } from './TimingEditor'
import './admin.css'

type Airport = {
  id: string
  icao: string
  name: string
  city: string | null
  fir: string
  active: boolean
  published: boolean
  archived_at: string | null
}

type RunwayConfig = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
  active: boolean
  published: boolean
  sort_order: number
  notes: string | null
}

type StarProcedure = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  runway_applicability: string | null
  chart_reference: string | null
  source: string | null
  effective_from: string | null
  effective_to: string | null
  active: boolean
}

type ConfigHistory = {
  id: number
  entity_type: string
  entity_id: string
  action: string
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
  changed_by_vid: string | null
  changed_by_name: string | null
  changed_at: string
}

type SequenceSession = { id: string; airport: string; flow: string; runway_config: string | null; service_date: string; status: string; created_at: string }

type Dashboard = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  starProcedures: StarProcedure[]
  history: ConfigHistory[]
  fixTimings: FixTiming[]
  sessions: SequenceSession[]
}

type Tab = 'airports' | 'stars' | 'timing' | 'sessions' | 'history'

const EMPTY: Dashboard = { airports: [], runwayConfigs: [], starProcedures: [], history: [], fixTimings: [], sessions: [] }

async function adminRequest(body?: Record<string, unknown>) {
  const response = await fetch('/api/admin/master', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json() as Dashboard & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Admin API returned ${response.status}`)
  return payload
}

function fmtTime(value: string) {
  return new Date(value).toLocaleString('en-GB', { hour12: false, timeZone: 'UTC' }) + ' UTC'
}

function publishState(active: boolean, published: boolean) {
  if (!active) return { label: 'ARCHIVED', className: 'archived' }
  if (published) return { label: 'PUBLISHED', className: 'published' }
  return { label: 'NOT PUBLISHED', className: 'draft' }
}

export default function AdminPanel() {
  const user = useAuthUser()
  const [data, setData] = useState<Dashboard>(EMPTY)
  const [tab, setTab] = useState<Tab>('airports')
  const [selectedAirportId, setSelectedAirportId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await adminRequest()
      setData(payload)
      setSelectedAirportId((current) => current || payload.airports[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  const selectedAirport = useMemo(() => data.airports.find((airport) => airport.id === selectedAirportId) ?? null, [data.airports, selectedAirportId])
  const selectedRunways = useMemo(() => data.runwayConfigs.filter((item) => item.airport_id === selectedAirportId), [data.runwayConfigs, selectedAirportId])
  const selectedRunwayIds = useMemo(() => new Set(selectedRunways.map((item) => item.id)), [selectedRunways])
  const selectedStars = useMemo(() => data.starProcedures.filter((item) => selectedRunwayIds.has(item.runway_config_id)), [data.starProcedures, selectedRunwayIds])

  const act = async (body: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    try {
      await adminRequest(body)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!user.isThailandStaff) {
    return <main className="admin-denied"><h1>Staff access required</h1><p>Thailand Division staff only.</p><a href="/">Back to sequencing</a></main>
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div>
          <div className="admin-eyebrow">THAILAND APPROACH TOOLS · STAFF</div>
          <h1>Bangkok FIR Arrival Sequencing Admin</h1>
          <p>Master data, procedures, timing, sessions and configuration history.</p>
        </div>
        <div className="admin-top-actions">
          <div className="admin-user"><strong>{user.name}</strong><span>{user.vid}</span></div>
          <a className="admin-back" href="/">← Sequencing</a>
        </div>
      </header>

      <main className="admin-main">
        <nav className="admin-tabs" aria-label="Admin sections">
          {(['airports','stars','timing','sessions','history'] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'airports' ? 'Airports' : item === 'stars' ? 'STAR Procedures' : item[0].toUpperCase() + item.slice(1)}</button>
          ))}
        </nav>

        {error && <div className="admin-error"><strong>Admin:</strong> {error}</div>}

        <section className="admin-overview">
          <article><span>Airports</span><strong>{data.airports.length}</strong><small>{data.airports.filter((x) => x.active && x.published).length} published</small></article>
          <article><span>Runway configs</span><strong>{data.runwayConfigs.length}</strong><small>{data.runwayConfigs.filter((x) => x.active && x.published).length} published</small></article>
          <article><span>STAR records</span><strong>{data.starProcedures.length}</strong><small>Optional per airport</small></article>
          <article><span>History revisions</span><strong>{data.history.length}</strong><small>Latest 150 loaded</small></article>
        </section>

        {loading ? <div className="admin-loading">Loading staff configuration…</div> : null}

        {!loading && tab === 'airports' && (
          <section className="admin-grid">
            <div className="admin-card airport-list-card">
              <div className="admin-card-heading"><div><span className="admin-label">AIRPORTS</span><h2>Bangkok FIR workspaces</h2></div><button onClick={() => {
                const icao = window.prompt('ICAO code (4 letters)')?.trim().toUpperCase()
                if (!icao) return
                const name = window.prompt('Airport name')?.trim()
                if (!name) return
                void act({ action: 'airport.create', icao, name, fir: 'BANGKOK', published: false })
              }} disabled={saving}>+ Add airport</button></div>
              <div className="admin-airport-list">
                {data.airports.map((airport) => {
                  const state = publishState(airport.active, airport.published)
                  return <button key={airport.id} className={`admin-airport-row ${selectedAirportId === airport.id ? 'selected' : ''}`} onClick={() => setSelectedAirportId(airport.id)}>
                    <span className="airport-code">{airport.icao}</span>
                    <span className="airport-copy"><strong>{airport.name}</strong><small>{airport.city || '—'} · {airport.fir} FIR</small></span>
                    <span className={`admin-state ${state.className}`}>{state.label}</span>
                  </button>
                })}
              </div>
            </div>

            <div className="admin-card airport-detail-card">
              {selectedAirport ? <>
                <div className="admin-card-heading">
                  <div><span className="admin-label">{selectedAirport.icao}</span><h2>{selectedAirport.name}</h2><p>{selectedAirport.city || 'No city set'} · {selectedAirport.fir} FIR</p></div>
                  <div className="admin-publish-actions">
                    {selectedAirport.active && <button className={selectedAirport.published ? 'unpublish-soft' : 'publish-soft'} onClick={() => void act({ action: 'airport.update', id: selectedAirport.id, published: !selectedAirport.published })} disabled={saving}>{selectedAirport.published ? 'Unpublish' : 'Publish'}</button>}
                    <button className={selectedAirport.active ? 'danger-soft' : 'restore-soft'} onClick={() => void act({ action: 'airport.update', id: selectedAirport.id, active: !selectedAirport.active })} disabled={saving}>{selectedAirport.active ? 'Archive airport' : 'Restore airport'}</button>
                  </div>
                </div>

                <div className="admin-section-title"><div><span className="admin-label">RUNWAY CONFIGURATIONS</span><h3>{selectedRunways.length} configured</h3></div><button onClick={() => {
                  const flow = window.prompt('Flow key (example: 21, 03, 01_02)')?.trim()
                  if (!flow) return
                  const label = window.prompt('Runway label (example: 21L / 21R)')?.trim()
                  if (!label) return
                  void act({ action: 'runway.create', airportId: selectedAirport.id, flow, label, timingStatus: 'PENDING', published: false, sortOrder: selectedRunways.length * 10 + 10 })
                }} disabled={saving}>+ Add configuration</button></div>

                <div className="runway-config-list">
                  {selectedRunways.length === 0 ? <div className="admin-empty">No runway configurations. Add one to create a sequencing workspace.</div> : selectedRunways.map((runway) => {
                    const state = publishState(runway.active, runway.published)
                    return <div className="runway-config-row" key={runway.id}>
                      <div><strong>{runway.label}</strong><small>flow: {runway.flow} · <span className={`inline-publish-state ${state.className}`}>{state.label}</span></small></div>
                      <select value={runway.timing_status} onChange={(event) => void act({ action: 'runway.update', id: runway.id, timingStatus: event.target.value })} disabled={saving}>
                        <option value="ACTIVE">TIMING ACTIVE</option><option value="PENDING">TIMING PENDING</option><option value="DISABLED">TIMING DISABLED</option>
                      </select>
                      <div className="runway-actions">
                        {runway.active && <button className={runway.published ? 'unpublish-link' : 'publish-link'} onClick={() => void act({ action: 'runway.update', id: runway.id, published: !runway.published })} disabled={saving}>{runway.published ? 'Unpublish' : 'Publish'}</button>}
                        <button className={runway.active ? 'danger-link' : 'restore-link'} onClick={() => void act({ action: 'runway.update', id: runway.id, active: !runway.active })} disabled={saving}>{runway.active ? 'Archive' : 'Restore'}</button>
                      </div>
                    </div>
                  })}
                </div>
              </> : <div className="admin-empty">Select an airport.</div>}
            </div>
          </section>
        )}

        {!loading && tab === 'stars' && (
          <section className="admin-card wide-card">
            <div className="admin-card-heading"><div><span className="admin-label">STAR PROCEDURES · OPTIONAL</span><h2>{selectedAirport?.icao ?? 'Select airport'}</h2><p>If an airport has no STAR, leave this section empty. No synthetic STAR record is required.</p></div><div className="star-actions"><select value={selectedAirportId} onChange={(event) => setSelectedAirportId(event.target.value)}>{data.airports.map((airport) => <option key={airport.id} value={airport.id}>{airport.icao} · {airport.name}</option>)}</select><button disabled={saving || selectedRunways.length === 0} onClick={() => {
              const runway = selectedRunways[0]
              if (!runway) return
              const designator = window.prompt(`STAR designator for ${runway.label}`)?.trim().toUpperCase()
              if (!designator) return
              const entryFix = window.prompt('Entry fix (optional)')?.trim().toUpperCase() || null
              void act({ action: 'star.create', runwayConfigId: runway.id, designator, entryFix, effectiveFrom: new Date().toISOString().slice(0,10), source: 'Manual admin entry' })
            }}>+ Add STAR</button></div></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CONFIG</th><th>STAR</th><th>ENTRY FIX</th><th>EFFECTIVE</th><th>SOURCE</th><th>STATUS</th><th /></tr></thead><tbody>
              {selectedStars.length === 0 ? <tr><td colSpan={7} className="admin-empty-cell">No STAR records for this airport. This is valid.</td></tr> : selectedStars.map((star) => {
                const runway = data.runwayConfigs.find((item) => item.id === star.runway_config_id)
                return <tr key={star.id}><td>{runway?.label ?? '—'}</td><td><strong>{star.designator}</strong></td><td>{star.entry_fix ?? '—'}</td><td>{star.effective_from ?? '—'}</td><td>{star.source ?? '—'}</td><td><span className={`admin-state ${star.active ? 'live' : 'archived'}`}>{star.active ? 'ACTIVE' : 'ARCHIVED'}</span></td><td><button className={star.active ? 'danger-link' : 'restore-link'} onClick={() => void act({ action: 'star.update', id: star.id, active: !star.active })}>{star.active ? 'Archive' : 'Restore'}</button></td></tr>
              })}
            </tbody></table></div>
          </section>
        )}

        {!loading && tab === 'timing' && (
          <TimingEditor airports={data.airports} runwayConfigs={data.runwayConfigs} fixTimings={data.fixTimings} saving={saving} act={act} />
        )}

        {!loading && tab === 'sessions' && (
          <section className="admin-card wide-card"><div className="admin-card-heading"><div><span className="admin-label">SESSIONS</span><h2>Sequence history</h2><p>Current and previous sequencing sessions. Session close/archive controls come next.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>DATE</th><th>AIRPORT</th><th>FLOW</th><th>RUNWAY</th><th>STATUS</th><th>CREATED</th></tr></thead><tbody>{data.sessions.map((session) => <tr key={session.id}><td>{session.service_date}</td><td><strong>{session.airport}</strong></td><td>{session.flow}</td><td>{session.runway_config ?? '—'}</td><td>{session.status}</td><td>{fmtTime(session.created_at)}</td></tr>)}</tbody></table></div></section>
        )}

        {!loading && tab === 'history' && (
          <section className="admin-card wide-card"><div className="admin-card-heading"><div><span className="admin-label">CONFIGURATION HISTORY</span><h2>Revision trail</h2><p>Append-only history. Restore creates another revision instead of deleting the mistake.</p></div><button onClick={() => void reload()}>Refresh</button></div><div className="history-list">{data.history.map((item) => {
            const snapshot = item.new_row || item.old_row || {}
            const title = String(snapshot.icao || snapshot.designator || snapshot.fix || snapshot.label || item.entity_id)
            const canRestore = Boolean(item.old_row) && ['AIRPORT','RUNWAY_CONFIG','STAR_PROCEDURE','FIX_TIMING'].includes(item.entity_type)
            return <article key={item.id} className="history-row"><div className="history-marker" /><div className="history-main"><div className="history-title"><strong>{item.entity_type.replaceAll('_', ' ')}</strong><span>{title}</span><span className={`history-action ${item.action.toLowerCase()}`}>{item.action}</span></div><p>{item.changed_by_name || 'TH Staff'} · {item.changed_by_vid || '—'} · {fmtTime(item.changed_at)}</p></div><button disabled={!canRestore || saving} onClick={() => { if (window.confirm(`Restore the state before revision #${item.id}?`)) void act({ action: 'history.restore', historyId: item.id }) }}>Restore previous</button></article>
          })}</div></section>
        )}
      </main>
    </div>
  )
}
