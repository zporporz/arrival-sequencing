import { useEffect, useState } from 'react'
import { useAuthUser } from './AuthGate'
import AipImporter from './AipImporter'
import AirportEditor from './AirportEditor'
import HistoryPanel from './HistoryPanel'
import SessionsPanel from './SessionsPanel'
import StarEditor from './StarEditor'
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

type SequenceSession = {
  id: string
  airport: string
  flow: string
  runway_config: string | null
  service_date: string
  status: string
  created_at: string
}

type Dashboard = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  starProcedures: StarProcedure[]
  history: ConfigHistory[]
  fixTimings: FixTiming[]
  sessions: SequenceSession[]
}

type Tab = 'airports' | 'stars' | 'aip' | 'timing' | 'sessions' | 'history'

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

export default function AdminPanelV2() {
  const user = useAuthUser()
  const [data, setData] = useState<Dashboard>(EMPTY)
  const [tab, setTab] = useState<Tab>('airports')
  const [selectedAirportId, setSelectedAirportId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await adminRequest()
      setData(payload)
      setSelectedAirportId((current) => current && payload.airports.some((airport) => airport.id === current) ? current : payload.airports[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

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
          {(['airports', 'stars', 'aip', 'timing', 'sessions', 'history'] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item === 'stars' ? 'STAR Procedures' : item === 'aip' ? 'AIP Import' : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        {error && <div className="admin-error"><strong>Admin:</strong> {error}</div>}

        <section className="admin-overview">
          <article><span>Airports</span><strong>{data.airports.length}</strong><small>{data.airports.filter((item) => item.active && item.published).length} published</small></article>
          <article><span>Runway configs</span><strong>{data.runwayConfigs.length}</strong><small>{data.runwayConfigs.filter((item) => item.active && item.published).length} published</small></article>
          <article><span>STAR records</span><strong>{data.starProcedures.length}</strong><small>Optional per airport</small></article>
          <article><span>History revisions</span><strong>{data.history.length}</strong><small>Latest 150 loaded</small></article>
        </section>

        {loading && <div className="admin-loading">Loading staff configuration…</div>}

        {!loading && tab === 'airports' && <AirportEditor airports={data.airports} runwayConfigs={data.runwayConfigs} selectedAirportId={selectedAirportId} onAirportChange={setSelectedAirportId} saving={saving} act={act} />}
        {!loading && tab === 'stars' && <StarEditor airports={data.airports} runwayConfigs={data.runwayConfigs} starProcedures={data.starProcedures} selectedAirportId={selectedAirportId} onAirportChange={setSelectedAirportId} saving={saving} act={act} />}
        {!loading && tab === 'aip' && <AipImporter airports={data.airports} runwayConfigs={data.runwayConfigs} starProcedures={data.starProcedures} reload={reload} />}
        {!loading && tab === 'timing' && <TimingEditor airports={data.airports} runwayConfigs={data.runwayConfigs} fixTimings={data.fixTimings} saving={saving} act={act} />}
        {!loading && tab === 'sessions' && <SessionsPanel sessions={data.sessions} />}
        {!loading && tab === 'history' && <HistoryPanel history={data.history} saving={saving} act={act} reload={reload} />}
      </main>
    </div>
  )
}
