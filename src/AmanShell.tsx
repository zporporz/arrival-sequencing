import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthUser } from './AuthGate'
import AmanTrafficSummary from './AmanTrafficSummary'
import IvaoTrafficPanel, { type TrafficAddItem, type TrafficFlight } from './IvaoTrafficPanel'
import { supabase } from './lib/supabase'
import type { ArrivalView, FixTiming, SequenceSession } from './types'

type PublishedAirport = { id: string; icao: string; name: string }
type PublishedRunway = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
}
type PublishedStarProcedure = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  effective_from: string | null
  effective_to: string | null
  active: boolean
}
type WorkspacePayload = {
  airports: PublishedAirport[]
  runwayConfigs: PublishedRunway[]
  starProcedures: PublishedStarProcedure[]
}
type LiveWorkspace = {
  airport: string
  airportName: string
  airportId: string
  flow: string
  runway: string
  runwayId: string
  timingReady: boolean
}

const requestedParams = new URLSearchParams(window.location.search)
const REQUESTED_AIRPORT = requestedParams.get('airport')?.trim().toUpperCase() || null
const REQUESTED_FLOW = requestedParams.get('flow')?.trim() || null

const timeOnly = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

const airportShortName = (name: string) => name.replace(/ International Airport$| Airport$/i, '')

const isoFromClock = (serviceDate: string, hhmm: string, anchor?: string | null) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const candidate = new Date(`${serviceDate}T00:00:00.000Z`)
  candidate.setUTCHours(hours, minutes, 0, 0)
  if (anchor) {
    const anchorDate = new Date(anchor)
    const delta = candidate.getTime() - anchorDate.getTime()
    if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
    if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  }
  return candidate.toISOString()
}

const airlineIcaoFromCallsign = (value: string | null | undefined) => {
  const callsign = String(value || '').trim().toUpperCase()
  return callsign.match(/^([A-Z]{3})[A-Z0-9]/)?.[1] || null
}

const delayMinutes = (target: string, estimate: string) => {
  const targetMs = new Date(target).getTime()
  const estimateMs = new Date(estimate).getTime()
  if (!Number.isFinite(targetMs) || !Number.isFinite(estimateMs)) return null
  let minutes = Math.round((targetMs - estimateMs) / 60_000)
  if (minutes > 720) minutes -= 1440
  if (minutes < -720) minutes += 1440
  return minutes
}

const delayLabel = (minutes: number | null) => minutes == null ? '—' : minutes > 0 ? `+${minutes}` : String(minutes)
const delayClass = (minutes: number | null) => minutes == null || minutes === 0 ? 'nothing' : minutes < 0 ? 'expedite' : 'delay'
const metricDelay = (minutes: number) => `${minutes > 0 ? '+' : ''}${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`

async function sequenceApi(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { error?: string; session?: unknown }
  if (!response.ok) throw new Error(payload.error || `Sequence API returned ${response.status}`)
  return payload
}

export default function AmanShell() {
  const authUser = useAuthUser()
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspacePayload>({ airports: [], runwayConfigs: [], starProcedures: [] })
  const [workspace, setWorkspace] = useState<LiveWorkspace | null>(null)
  const [session, setSession] = useState<SequenceSession | null>(null)
  const [arrivals, setArrivals] = useState<ArrivalView[]>([])
  const [fixes, setFixes] = useState<FixTiming[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [utcNow, setUtcNow] = useState(new Date())

  const refreshArrivals = useCallback(async (sessionId: string) => {
    const { data, error: queryError } = await supabase
      .from('arrival_sequence_view')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence_no', { ascending: true })
      .order('cldt', { ascending: true })
    if (queryError) throw queryError
    setArrivals((data ?? []) as ArrivalView[])
  }, [])

  const loadFixes = useCallback(async (activeSession: SequenceSession) => {
    const { data, error: queryError } = await supabase
      .from('fix_timings')
      .select('*')
      .eq('airport', activeSession.airport)
      .eq('flow', activeSession.flow)
      .eq('active', true)
      .lte('effective_from', activeSession.service_date)
      .order('effective_from', { ascending: false })
    if (queryError) throw queryError
    const byFix = new Map<string, FixTiming>()
    for (const row of (data ?? []) as FixTiming[]) {
      if (row.effective_to && row.effective_to < activeSession.service_date) continue
      if (!byFix.has(row.fix)) byFix.set(row.fix, row)
    }
    setFixes([...byFix.values()].sort((a, b) => a.fix.localeCompare(b.fix)))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setUtcNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let disposed = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    const bootstrap = async () => {
      try {
        setLoading(true)
        setError(null)
        const workspaceResponse = await fetch('/api/workspaces', { credentials: 'same-origin', cache: 'no-store' })
        if (!workspaceResponse.ok) throw new Error('Unable to load published workspaces')
        const raw = await workspaceResponse.json() as Partial<WorkspacePayload>
        const config: WorkspacePayload = {
          airports: raw.airports ?? [],
          runwayConfigs: raw.runwayConfigs ?? [],
          starProcedures: raw.starProcedures ?? [],
        }
        const airportById = new Map(config.airports.map((airport) => [airport.id, airport]))
        const candidates = config.runwayConfigs.flatMap((runway): LiveWorkspace[] => {
          const airport = airportById.get(runway.airport_id)
          if (!airport) return []
          return [{ airport: airport.icao, airportName: airportShortName(airport.name), airportId: airport.id, flow: runway.flow, runway: runway.label, runwayId: runway.id, timingReady: runway.timing_status === 'ACTIVE' }]
        })
        const selected = candidates.find((item) => item.airport === REQUESTED_AIRPORT && item.flow === REQUESTED_FLOW)
          ?? candidates.find((item) => item.airport === REQUESTED_AIRPORT)
          ?? candidates[0]
        if (!selected) throw new Error('No published arrival workspace is available')
        if (disposed) return
        setWorkspaceConfig(config)
        setWorkspace(selected)

        const canonicalUrl = new URL(window.location.href)
        canonicalUrl.searchParams.delete('legacy')
        canonicalUrl.searchParams.set('airport', selected.airport)
        canonicalUrl.searchParams.set('flow', selected.flow)
        canonicalUrl.searchParams.set('runway', selected.runway)
        window.history.replaceState(null, '', canonicalUrl.toString())

        const sessionPayload = await sequenceApi('/api/sequence/session', { airport: selected.airport, flow: selected.flow })
        const activeSession = sessionPayload.session as SequenceSession | null
        if (!activeSession || disposed) return
        setSession(activeSession)
        await Promise.all([refreshArrivals(activeSession.id), loadFixes(activeSession)])

        channel = supabase
          .channel(`aman-v2:${activeSession.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'arrivals' }, () => {
            void refreshArrivals(activeSession.id).catch((err: Error) => setError(err.message))
          })
          .subscribe()
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      disposed = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [loadFixes, refreshArrivals])

  const activeRows = useMemo(() => arrivals
    .filter((row) => !['LANDED', 'CANCELLED'].includes(row.status))
    .sort((left, right) => left.sequence_no - right.sequence_no || new Date(left.cldt).getTime() - new Date(right.cldt).getTime()), [arrivals])

  const delays = activeRows.map((row) => delayMinutes(row.cldt, row.eldt)).filter((value): value is number => value != null)
  const averageDelay = delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : 0
  const maxDelay = delays.length ? Math.max(0, ...delays) : 0
  const timeSorted = [...activeRows].sort((a, b) => new Date(a.cldt).getTime() - new Date(b.cldt).getTime())
  const earliest = timeSorted[0] ?? null
  const latest = timeSorted[timeSorted.length - 1] ?? null

  const switchWorkspace = (airport: PublishedAirport, runway: PublishedRunway) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('legacy')
    url.searchParams.set('airport', airport.icao)
    url.searchParams.set('flow', runway.flow)
    url.searchParams.set('runway', runway.label)
    window.location.assign(url.toString())
  }

  const legacyHref = useMemo(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('legacy', '1')
    return `${url.pathname}${url.search}`
  }, [workspace?.airport, workspace?.flow])

  const addFlight = async () => {
    if (!session || fixes.length === 0) return
    try {
      setError(null)
      const now = new Date()
      const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
      const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
      await sequenceApi('/api/sequence/arrival', {
        action: 'create', sessionId: session.id, sequenceNo, callsign: 'NEW', aircraftType: null, departure: null,
        refFix: fixes[0].fix, eto: isoFromClock(session.service_date, hhmm),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const addIvaoFlight = async (flight: TrafficFlight, refFix: string, eto: string) => {
    if (!session) throw new Error('No active sequence session')
    const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
    await sequenceApi('/api/sequence/arrival', {
      action: 'create', sessionId: session.id, sequenceNo, callsign: flight.callsign, aircraftType: flight.aircraft,
      departure: flight.departure, refFix, eto: isoFromClock(session.service_date, eto, new Date().toISOString()),
    })
  }

  const addIvaoFlights = async (items: TrafficAddItem[]) => {
    if (!session) throw new Error('No active sequence session')
    let sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
    for (const item of items) {
      await sequenceApi('/api/sequence/arrival', {
        action: 'create', sessionId: session.id, sequenceNo, callsign: item.flight.callsign, aircraftType: item.flight.aircraft,
        departure: item.flight.departure, refFix: item.refFix, eto: isoFromClock(session.service_date, item.eto, new Date().toISOString()),
      })
      sequenceNo += 1
    }
  }

  const deleteFlight = async (row: ArrivalView) => {
    if (!window.confirm(`Remove ${row.callsign} from the arrival sequence?`)) return
    try {
      setError(null)
      await sequenceApi('/api/sequence/arrival', { action: 'delete', id: row.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="app-shell aman-v2-shell">
      <header className="topbar aman-v2-topbar">
        <div className="brand-block">
          <div className="brand-mark">A</div>
          <div><div className="eyebrow">THAILAND APPROACH TOOLS</div><h1>AMAN – Arrival Manager</h1><p>{workspace ? `${workspace.airport} · ${workspace.airportName} · RWY ${workspace.runway}` : 'Loading workspace…'}</p></div>
        </div>
        <div className="topbar-actions">
          <div className="clock-card"><span>UTC</span><strong>{utcNow.toISOString().slice(11, 19)}</strong></div>
          <div className="connection-pill"><span className="live-dot" /> REALTIME</div>
          <a className="aman-header-link" href={legacyHref}>Detailed editor</a>
          {authUser.isThailandStaff && <a className="aman-header-link" href="/admin">Admin</a>}
          <details className="aman-account-menu">
            <summary className="aman-user-chip"><span className="aman-user-avatar">{authUser.name.slice(0, 2).toUpperCase()}</span><span className="aman-user-text"><strong>{authUser.name}</strong><small>VID {authUser.vid}</small></span><b>▾</b></summary>
            <div className="aman-account-popover">
              <div className="aman-account-identity"><strong>{authUser.name}</strong><span>VID {authUser.vid}</span></div>
              <a href={legacyHref}>Open detailed editor</a>
              {authUser.isThailandStaff && <a href="/admin">Open Admin Console</a>}
              <a className="aman-signout-link" href="/api/auth/logout">Sign out of IVAO</a>
            </div>
          </details>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-banner"><strong>AMAN:</strong> {error}</div>}

        {workspace && <section className="sequence-destination-nav" aria-label="AMAN workspace navigation">
          <div className="destination-nav-row airport-nav-row">
            <div className="destination-nav-heading"><span>AIRPORT</span><strong>AMAN workspace</strong></div>
            <div className="airport-workspace-tabs">{workspaceConfig.airports.map((airport) => {
              const runway = workspaceConfig.runwayConfigs.find((item) => item.airport_id === airport.id)
              if (!runway) return null
              const selected = workspace.airport === airport.icao
              return <button key={airport.id} type="button" className={`airport-workspace-button${selected ? ' is-active' : ''}`} onClick={() => { if (!selected) switchWorkspace(airport, runway) }}><span className="airport-workspace-code">{airport.icao}</span><span className="airport-workspace-name">{airportShortName(airport.name)}</span></button>
            })}</div>
          </div>
          <div className="destination-nav-row runway-nav-row">
            <div className="destination-nav-heading"><span>RUNWAY CONFIG</span><strong>{workspace.airport}</strong></div>
            <div className="runway-workspace-tabs">{workspaceConfig.runwayConfigs.filter((runway) => runway.airport_id === workspace.airportId).map((runway) => {
              const airport = workspaceConfig.airports.find((item) => item.id === runway.airport_id)
              if (!airport) return null
              const selected = runway.id === workspace.runwayId
              return <button key={runway.id} type="button" className={`runway-workspace-button ${selected ? 'is-active ' : ''}${runway.timing_status === 'ACTIVE' ? 'is-ready' : 'is-pending'}`} onClick={() => { if (!selected) switchWorkspace(airport, runway) }}><span className="runway-workspace-runway">{runway.label}</span><small className="runway-workspace-state">{runway.timing_status === 'ACTIVE' ? 'TIMING ACTIVE' : runway.timing_status}</small></button>
            })}</div>
          </div>
        </section>}

        <section className="aman-status-strip">
          <article className="aman-stat-card"><span>In sequence</span><strong>{activeRows.length}</strong><small>active arrivals</small></article>
          <article className="aman-stat-card delay"><span>Average delay</span><strong>{metricDelay(averageDelay)}</strong><small>TLDT − ELDT</small></article>
          <article className="aman-stat-card max-delay"><span>Max delay</span><strong>{metricDelay(maxDelay)}</strong><small>required time</small></article>
          <article className="aman-stat-card"><span>Earliest TLDT</span><strong>{earliest ? timeOnly(earliest.cldt) : '—'}</strong><small>{earliest?.callsign ?? 'No traffic'}</small></article>
          <article className="aman-stat-card"><span>Latest TLDT</span><strong>{latest ? timeOnly(latest.cldt) : '—'}</strong><small>{latest?.callsign ?? 'No traffic'}</small></article>
          <article className="aman-stat-card"><span>Workspace</span><strong>{workspace?.airport ?? '—'}</strong><small>{workspace?.runway ?? 'Loading'}</small></article>
        </section>

        {workspace && !workspace.timingReady && <div className="timing-pending-banner"><strong>{workspace.airport} timing unavailable</strong><span>Add Flight is disabled until timing is activated in Admin.</span></div>}

        {workspace && <section className="aman-main-grid">
          <article className="aman-sequence-panel">
            <div className="aman-panel-head">
              <div><span>AMAN TIMELINE · UTC</span><h2>{workspace.airport} — Arrival Sequence</h2></div>
              <div className="aman-panel-actions"><button className="primary-button" onClick={() => void addFlight()} disabled={!session || !workspace.timingReady || fixes.length === 0}>+ Add Flight</button><a className="aman-table-link" href={legacyHref}>Edit table</a></div>
            </div>
            <div className="aman-sequence-table-wrap">
              <table className="aman-sequence-table">
                <thead><tr><th>TLDT<small>Target Landing Time</small></th><th>CALLSIGN</th><th>TYPE</th><th>IAWP / STAR<small>Entry fix / procedure</small></th><th>TTO<small>Target Time Over</small></th><th>DELAY<small>Required</small></th><th>RWY CFG</th><th className="aman-action-head">ACTION</th></tr></thead>
                <tbody>{loading ? <tr><td colSpan={8} className="aman-panel-empty">Connecting to shared sequence…</td></tr> : activeRows.length === 0 ? <tr><td colSpan={8} className="aman-panel-empty">No active arrivals in sequence.</td></tr> : activeRows.map((row) => {
                  const delay = delayMinutes(row.cldt, row.eldt)
                  const stars = workspaceConfig.starProcedures.filter((star) => star.runway_config_id === workspace.runwayId && star.active && star.entry_fix?.toUpperCase() === row.ref_fix.toUpperCase()).map((star) => star.designator)
                  const airline = airlineIcaoFromCallsign(row.callsign)
                  return <tr key={row.id}>
                    <td className="aman-tldt">{timeOnly(row.cldt)}</td>
                    <td className="aman-callsign"><div className="aman-callsign-line">{airline && <span className="sequence-airline-logo"><img src={`/api/sequence/airline-logo?icao=${encodeURIComponent(airline)}`} alt="" onError={(event) => { event.currentTarget.closest('.sequence-airline-logo')?.classList.add('is-missing') }} /></span>}<span>{row.callsign}</span></div></td>
                    <td>{row.aircraft_type || '—'}</td>
                    <td className="aman-iawp"><strong>{row.ref_fix}</strong>{stars.length > 0 && <small>{stars.slice(0, 2).join(' / ')}</small>}</td>
                    <td className="aman-tto">{timeOnly(row.cto)}</td>
                    <td><span className={`aman-delay-pill ${delayClass(delay)}`}>{delayLabel(delay)}</span></td>
                    <td className="aman-runway-config">{workspace.runway}</td>
                    <td className="aman-action-cell"><button type="button" className="aman-delete-flight" onClick={() => void deleteFlight(row)} title={`Remove ${row.callsign} from sequence`} aria-label={`Remove ${row.callsign} from sequence`}>×</button></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          </article>

          <aside><AmanTrafficSummary airport={workspace.airport} existingCallsigns={arrivals.map((row) => row.callsign)} importControl={<IvaoTrafficPanel
            airport={workspace.airport}
            fixes={fixes.map((fix) => fix.fix)}
            starProcedures={workspaceConfig.starProcedures.filter((star) => star.runway_config_id === workspace.runwayId && star.active).filter((star) => !session || (!star.effective_from || star.effective_from <= session.service_date) && (!star.effective_to || star.effective_to >= session.service_date)).flatMap((star) => star.entry_fix ? [{ designator: star.designator, entryFix: star.entry_fix }] : [])}
            existingCallsigns={arrivals.map((row) => row.callsign)} disabled={!session || !workspace.timingReady || fixes.length === 0} onAdd={addIvaoFlight} onAddAll={addIvaoFlights}
          />} /></aside>
        </section>}

        <section className="aman-delay-legend">
          <strong>DELAY COLOUR CODING</strong>
          <span className="aman-delay-key expedite"><i /> Expedite</span><span className="aman-delay-key nothing"><i /> Nothing</span><span className="aman-delay-key speed"><i /> Speed reduction</span><span className="aman-delay-key stretch"><i /> Path stretching</span><span className="aman-delay-key holding"><i /> Holding</span>
          <span className="aman-delay-legend-note">Action thresholds are not configured yet; positive delay currently shows required time only.</span>
        </section>
      </main>
    </div>
  )
}
