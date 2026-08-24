import { useEffect, useMemo, useState } from 'react'
import './staffMasterDataAdmin.css'
import { useAuthUser } from './AuthGate'

type Airport = {
  id: string
  icao: string
  name: string
  city: string | null
  fir: string | null
  active: boolean
  published?: boolean
}

type Runway = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
  active: boolean
  published?: boolean
  sort_order: number
  notes: string | null
}

type Timing = {
  id: number
  runway_config_id: string
  airport: string
  flow: string
  fix: string
  nominal_seconds: number
  source: string
  verified: boolean
  effective_from: string
  effective_to: string | null
  active: boolean
}

type Dashboard = {
  airports: Airport[]
  runwayConfigs: Runway[]
  fixTimings: Timing[]
  starProcedures: unknown[]
  history: unknown[]
  sessions: unknown[]
}

type Tab = 'TIMING' | 'RUNWAY' | 'AIRPORT'

const EMPTY: Dashboard = {
  airports: [],
  runwayConfigs: [],
  fixTimings: [],
  starProcedures: [],
  history: [],
  sessions: [],
}

const todayUtc = () => new Date().toISOString().slice(0, 10)

async function adminApi<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/admin/master', body ? {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Admin API returned ${response.status}`)
  return payload as T
}

export default function StaffMasterDataAdmin() {
  const user = useAuthUser()
  const [dashboard, setDashboard] = useState<Dashboard>(EMPTY)
  const [tab, setTab] = useState<Tab>('TIMING')
  const [airportFilter, setAirportFilter] = useState('ALL')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('LOADING')
  const [error, setError] = useState<string | null>(null)

  const [timing, setTiming] = useState({
    id: null as number | null,
    runwayConfigId: '',
    airport: 'VTBS',
    flow: '',
    fix: '',
    minutes: '',
    source: '',
    verified: false,
    effectiveFrom: todayUtc(),
    effectiveTo: '',
    active: true,
  })

  const [runway, setRunway] = useState({
    id: null as string | null,
    airportId: '',
    flow: '',
    label: '',
    timingStatus: 'PENDING' as Runway['timing_status'],
    sortOrder: '0',
    notes: '',
    active: true,
    published: false,
  })

  const [airport, setAirport] = useState({
    id: null as string | null,
    icao: '',
    name: '',
    city: '',
    fir: 'BANGKOK',
    active: true,
    published: false,
  })

  const load = async () => {
    setStatus('LOADING')
    setError(null)
    try {
      setDashboard(await adminApi<Dashboard>())
      setStatus('READY')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('ERROR')
    }
  }

  useEffect(() => {
    if (user.isThailandStaff) void load()
  }, [user.isThailandStaff])

  const airportById = useMemo(
    () => new Map(dashboard.airports.map((item) => [item.id, item])),
    [dashboard.airports],
  )

  const filteredTimings = dashboard.fixTimings.filter((item) => airportFilter === 'ALL' || item.airport === airportFilter)
  const filteredRunways = dashboard.runwayConfigs.filter((item) => airportFilter === 'ALL' || airportById.get(item.airport_id)?.icao === airportFilter)
  const timingRunways = dashboard.runwayConfigs.filter((item) => airportById.get(item.airport_id)?.icao === timing.airport)

  const mutate = async (body: Record<string, unknown>, message: string) => {
    setBusy(true)
    setError(null)
    try {
      await adminApi(body)
      await load()
      setStatus(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const newTiming = () => {
    const apt = airportFilter === 'ALL' ? 'VTBS' : airportFilter
    const rw = dashboard.runwayConfigs.find((item) => airportById.get(item.airport_id)?.icao === apt)
    setTiming({
      id: null,
      runwayConfigId: rw?.id || '',
      airport: apt,
      flow: rw?.flow || '',
      fix: '',
      minutes: '',
      source: '',
      verified: false,
      effectiveFrom: todayUtc(),
      effectiveTo: '',
      active: true,
    })
  }

  if (!user.isThailandStaff) {
    return <main className="masteradmin-denied"><strong>STAFF ACCESS REQUIRED</strong><span>Thailand Division staff only.</span><a href="/">Return to AMAN</a></main>
  }

  return <div className="masteradmin-app">
    <header className="masteradmin-topbar">
      <div><span>IVAO THAILAND · STAFF</span><strong>AMAN MASTER DATA</strong></div>
      <nav><a href="/?admin=tools">← ADMIN TOOLS</a><span>{user.name} · {user.vid}</span><a href="/api/auth/logout">Sign out</a></nav>
    </header>

    <main className="masteradmin-main">
      <section className="masteradmin-hero">
        <div><span>MASTER DATA</span><h1>Airport / Runway / Timing</h1><p>Edit staff master data for airports, runway flows and nominal fix-to-landing timing.</p></div>
        <b>{busy ? 'SAVING' : status}</b>
      </section>

      <section className="masteradmin-warning">
        <strong>DATABASE EDITOR LIVE</strong>
        <span>Changes are stored and audited in Supabase. Production AMAN still uses hard-coded runway and nominal STAR timing constants until the runtime is wired to published master data.</span>
      </section>

      <section className="masteradmin-summary">
        <article><span>AIRPORTS</span><strong>{dashboard.airports.length}</strong></article>
        <article><span>RUNWAY FLOWS</span><strong>{dashboard.runwayConfigs.length}</strong></article>
        <article><span>FIX TIMINGS</span><strong>{dashboard.fixTimings.length}</strong></article>
        <article><span>VERIFIED</span><strong>{dashboard.fixTimings.filter((item) => item.verified).length}</strong></article>
      </section>

      <section className="masteradmin-toolbar">
        <div>
          <button className={tab === 'TIMING' ? 'active' : ''} onClick={() => setTab('TIMING')}>FIX TIMING</button>
          <button className={tab === 'RUNWAY' ? 'active' : ''} onClick={() => setTab('RUNWAY')}>RUNWAY FLOW</button>
          <button className={tab === 'AIRPORT' ? 'active' : ''} onClick={() => setTab('AIRPORT')}>AIRPORT</button>
        </div>
        <label><span>AIRPORT</span><select value={airportFilter} onChange={(event) => setAirportFilter(event.target.value)}><option value="ALL">ALL</option>{dashboard.airports.map((item) => <option key={item.id} value={item.icao}>{item.icao}</option>)}</select></label>
        <button disabled={busy} onClick={() => void load()}>REFRESH</button>
      </section>

      {error && <div className="masteradmin-error">{error}</div>}

      {tab === 'TIMING' && <div className="masteradmin-grid">
        <section className="masteradmin-card">
          <header><div><span>NOMINAL FIX → LANDING</span><h2>Fix timings</h2></div><button onClick={newTiming}>+ NEW</button></header>
          <div className="masteradmin-list masteradmin-list-head cols6"><b>APT</b><b>FLOW</b><b>FIX</b><b>MIN</b><b>VER</b><b>STATE</b></div>
          {filteredTimings.map((item) => <button key={item.id} className={`masteradmin-list cols6 ${timing.id === item.id ? 'selected' : ''}`} onClick={() => setTiming({
            id: item.id,
            runwayConfigId: item.runway_config_id,
            airport: item.airport,
            flow: item.flow,
            fix: item.fix,
            minutes: String(item.nominal_seconds / 60),
            source: item.source,
            verified: item.verified,
            effectiveFrom: item.effective_from,
            effectiveTo: item.effective_to || '',
            active: item.active,
          })}>
            <strong>{item.airport}</strong><span>{item.flow}</span><strong>{item.fix}</strong><span>{(item.nominal_seconds / 60).toFixed(item.nominal_seconds % 60 ? 1 : 0)}</span><span>{item.verified ? 'YES' : 'NO'}</span><i>{item.active ? 'ACTIVE' : 'OFF'}</i>
          </button>)}
          {!filteredTimings.length && <p>No timing records.</p>}
        </section>

        <section className="masteradmin-card masteradmin-editor">
          <header><div><span>{timing.id == null ? 'CREATE' : 'EDIT'}</span><h2>{timing.id == null ? 'New fix timing' : `${timing.airport} ${timing.fix}`}</h2></div></header>
          <div className="masteradmin-form-grid">
            <label><span>Airport</span><select disabled={timing.id != null} value={timing.airport} onChange={(event) => {
              const apt = event.target.value
              const rw = dashboard.runwayConfigs.find((item) => airportById.get(item.airport_id)?.icao === apt)
              setTiming((current) => ({ ...current, airport: apt, runwayConfigId: rw?.id || '', flow: rw?.flow || '' }))
            }}>{dashboard.airports.map((item) => <option key={item.id} value={item.icao}>{item.icao}</option>)}</select></label>
            <label><span>Runway flow</span><select disabled={timing.id != null} value={timing.runwayConfigId} onChange={(event) => {
              const rw = dashboard.runwayConfigs.find((item) => item.id === event.target.value)
              setTiming((current) => ({ ...current, runwayConfigId: event.target.value, flow: rw?.flow || '' }))
            }}><option value="">SELECT</option>{timingRunways.map((item) => <option key={item.id} value={item.id}>{item.flow} · {item.label}</option>)}</select></label>
            <label><span>Reference fix</span><input disabled={timing.id != null} value={timing.fix} onChange={(event) => setTiming((current) => ({ ...current, fix: event.target.value.toUpperCase() }))} placeholder="NORTA" /></label>
            <label><span>Nominal minutes</span><input type="number" min="0.1" max="180" step="0.1" value={timing.minutes} onChange={(event) => setTiming((current) => ({ ...current, minutes: event.target.value }))} placeholder="21.5" /></label>
            <label><span>Effective from</span><input disabled={timing.id != null} type="date" value={timing.effectiveFrom} onChange={(event) => setTiming((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
            <label><span>Effective to</span><input type="date" value={timing.effectiveTo} onChange={(event) => setTiming((current) => ({ ...current, effectiveTo: event.target.value }))} /></label>
          </div>
          <label className="masteradmin-wide"><span>Source / evidence</span><textarea rows={5} value={timing.source} onChange={(event) => setTiming((current) => ({ ...current, source: event.target.value }))} placeholder="Operational sample / chart calculation / verified source" /></label>
          <div className="masteradmin-checks"><label><input type="checkbox" checked={timing.verified} onChange={(event) => setTiming((current) => ({ ...current, verified: event.target.checked }))} /> VERIFIED</label><label><input type="checkbox" checked={timing.active} onChange={(event) => setTiming((current) => ({ ...current, active: event.target.checked }))} /> ACTIVE</label></div>
          <button className="primary" disabled={busy} onClick={() => void mutate(timing.id == null ? {
            action: 'timing.create', runwayConfigId: timing.runwayConfigId, airport: timing.airport, flow: timing.flow, fix: timing.fix, nominalMinutes: Number(timing.minutes), source: timing.source, verified: timing.verified, effectiveFrom: timing.effectiveFrom, effectiveTo: timing.effectiveTo || null, active: timing.active,
          } : {
            action: 'timing.update', id: timing.id, nominalMinutes: Number(timing.minutes), source: timing.source, verified: timing.verified, effectiveTo: timing.effectiveTo || null, active: timing.active,
          }, 'TIMING SAVED')}>SAVE TIMING</button>
        </section>
      </div>}

      {tab === 'RUNWAY' && <div className="masteradmin-grid">
        <section className="masteradmin-card">
          <header><div><span>CONFIGURATION</span><h2>Runway flows</h2></div><button onClick={() => setRunway({ id:null, airportId:'', flow:'', label:'', timingStatus:'PENDING', sortOrder:'0', notes:'', active:true, published:false })}>+ NEW</button></header>
          <div className="masteradmin-list masteradmin-list-head cols5"><b>APT</b><b>FLOW</b><b>LABEL</b><b>STATUS</b><b>PUB</b></div>
          {filteredRunways.map((item) => <button key={item.id} className={`masteradmin-list cols5 ${runway.id === item.id ? 'selected' : ''}`} onClick={() => setRunway({ id:item.id, airportId:item.airport_id, flow:item.flow, label:item.label, timingStatus:item.timing_status, sortOrder:String(item.sort_order), notes:item.notes || '', active:item.active, published:Boolean(item.published) })}><strong>{airportById.get(item.airport_id)?.icao || '----'}</strong><strong>{item.flow}</strong><span>{item.label}</span><i>{item.timing_status}</i><span>{item.published ? 'YES' : 'NO'}</span></button>)}
        </section>

        <section className="masteradmin-card masteradmin-editor">
          <header><div><span>{runway.id == null ? 'CREATE' : 'EDIT'}</span><h2>{runway.id == null ? 'New runway flow' : runway.flow}</h2></div></header>
          <div className="masteradmin-form-grid">
            <label><span>Airport</span><select disabled={runway.id != null} value={runway.airportId} onChange={(event) => setRunway((current) => ({ ...current, airportId:event.target.value }))}><option value="">SELECT</option>{dashboard.airports.map((item) => <option key={item.id} value={item.id}>{item.icao} · {item.name}</option>)}</select></label>
            <label><span>Flow</span><input disabled={runway.id != null} value={runway.flow} onChange={(event) => setRunway((current) => ({ ...current, flow:event.target.value.toUpperCase() }))} placeholder="19_20" /></label>
            <label><span>Label</span><input value={runway.label} onChange={(event) => setRunway((current) => ({ ...current, label:event.target.value }))} placeholder="19 / 20L / 20R" /></label>
            <label><span>Timing status</span><select value={runway.timingStatus} onChange={(event) => setRunway((current) => ({ ...current, timingStatus:event.target.value as Runway['timing_status'] }))}><option>ACTIVE</option><option>PENDING</option><option>DISABLED</option></select></label>
            <label><span>Sort order</span><input type="number" value={runway.sortOrder} onChange={(event) => setRunway((current) => ({ ...current, sortOrder:event.target.value }))} /></label>
          </div>
          <label className="masteradmin-wide"><span>Notes</span><textarea rows={5} value={runway.notes} onChange={(event) => setRunway((current) => ({ ...current, notes:event.target.value }))} /></label>
          <div className="masteradmin-checks"><label><input type="checkbox" checked={runway.active} onChange={(event) => setRunway((current) => ({ ...current, active:event.target.checked }))} /> ACTIVE</label><label><input type="checkbox" checked={runway.published} onChange={(event) => setRunway((current) => ({ ...current, published:event.target.checked }))} /> PUBLISHED</label></div>
          <button className="primary" disabled={busy} onClick={() => void mutate(runway.id == null ? {
            action:'runway.create', airportId:runway.airportId, flow:runway.flow, label:runway.label, timingStatus:runway.timingStatus, sortOrder:Number(runway.sortOrder), notes:runway.notes, active:runway.active, published:runway.published,
          } : {
            action:'runway.update', id:runway.id, label:runway.label, timingStatus:runway.timingStatus, sortOrder:Number(runway.sortOrder), notes:runway.notes, active:runway.active, published:runway.published,
          }, 'RUNWAY SAVED')}>SAVE RUNWAY</button>
        </section>
      </div>}

      {tab === 'AIRPORT' && <div className="masteradmin-grid">
        <section className="masteradmin-card">
          <header><div><span>LOCATION</span><h2>Airports</h2></div><button onClick={() => setAirport({ id:null, icao:'', name:'', city:'', fir:'BANGKOK', active:true, published:false })}>+ NEW</button></header>
          <div className="masteradmin-list masteradmin-list-head cols4"><b>ICAO</b><b>NAME</b><b>ACTIVE</b><b>PUB</b></div>
          {dashboard.airports.filter((item) => airportFilter === 'ALL' || item.icao === airportFilter).map((item) => <button key={item.id} className={`masteradmin-list cols4 ${airport.id === item.id ? 'selected' : ''}`} onClick={() => setAirport({ id:item.id, icao:item.icao, name:item.name, city:item.city || '', fir:item.fir || 'BANGKOK', active:item.active, published:Boolean(item.published) })}><strong>{item.icao}</strong><span>{item.name}</span><span>{item.active ? 'YES' : 'NO'}</span><span>{item.published ? 'YES' : 'NO'}</span></button>)}
        </section>

        <section className="masteradmin-card masteradmin-editor">
          <header><div><span>{airport.id == null ? 'CREATE' : 'EDIT'}</span><h2>{airport.id == null ? 'New airport' : airport.icao}</h2></div></header>
          <div className="masteradmin-form-grid">
            <label><span>ICAO</span><input disabled={airport.id != null} maxLength={4} value={airport.icao} onChange={(event) => setAirport((current) => ({ ...current, icao:event.target.value.toUpperCase() }))} /></label>
            <label><span>Name</span><input value={airport.name} onChange={(event) => setAirport((current) => ({ ...current, name:event.target.value }))} /></label>
            <label><span>City</span><input value={airport.city} onChange={(event) => setAirport((current) => ({ ...current, city:event.target.value }))} /></label>
            <label><span>FIR</span><input value={airport.fir} onChange={(event) => setAirport((current) => ({ ...current, fir:event.target.value.toUpperCase() }))} /></label>
          </div>
          <div className="masteradmin-checks"><label><input type="checkbox" checked={airport.active} onChange={(event) => setAirport((current) => ({ ...current, active:event.target.checked }))} /> ACTIVE</label><label><input type="checkbox" checked={airport.published} onChange={(event) => setAirport((current) => ({ ...current, published:event.target.checked }))} /> PUBLISHED</label></div>
          <button className="primary" disabled={busy} onClick={() => void mutate(airport.id == null ? {
            action:'airport.create', icao:airport.icao, name:airport.name, city:airport.city, fir:airport.fir, active:airport.active, published:airport.published,
          } : {
            action:'airport.update', id:airport.id, name:airport.name, city:airport.city, fir:airport.fir, active:airport.active, published:airport.published,
          }, 'AIRPORT SAVED')}>SAVE AIRPORT</button>
        </section>
      </div>}
    </main>
  </div>
}
