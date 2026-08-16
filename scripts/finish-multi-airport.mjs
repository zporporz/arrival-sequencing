import fs from 'node:fs'

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === before) throw new Error(`No changes made to ${path}`)
  fs.writeFileSync(path, after)
}

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing target: ${label}`)
  return text.replace(from, to)
}

edit('src/types.ts', (text) => text
  .replace("airport: 'VTBD' | 'VTBS'", 'airport: string')
  .replace("airport: 'VTBD' | 'VTBS'", 'airport: string')
  .replace("airport: 'VTBD' | 'VTBS'", 'airport: string'))

edit('src/main.tsx', (text) => text
  .replace("import { installFlowSelector } from './flowSelector'\n", '')
  .replace('installFlowSelector()\n', ''))

edit('src/lifecyclePanel.ts', (text) => {
  text = replaceOnce(text,
`function currentFlow() {
  return new URLSearchParams(window.location.search).get('flow') === '03' ? '03' : '21'
}`,
`function currentWorkspaceSelection() {
  const params = new URLSearchParams(window.location.search)
  return {
    airport: params.get('airport')?.trim().toUpperCase() || 'VTBD',
    flow: params.get('flow')?.trim() || '21',
  }
}`,
'current workspace selection')

  text = replaceOnce(text,
`  const todayUtc = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('sequence_sessions')
    .select('id')
    .eq('airport', 'VTBD')
    .eq('flow', currentFlow())
    .eq('service_date', todayUtc)
    .eq('status', 'ACTIVE')`,
`  const todayUtc = new Date().toISOString().slice(0, 10)
  const selected = currentWorkspaceSelection()
  const { data, error } = await supabase
    .from('sequence_sessions')
    .select('id')
    .eq('airport', selected.airport)
    .eq('flow', selected.flow)
    .eq('service_date', todayUtc)
    .eq('status', 'ACTIVE')
    .eq('archived', false)`,
'dynamic activity session')
  return text
})

edit('src/App.tsx', (text) => {
  text = replaceOnce(text,
`const AIRPORT = 'VTBD' as const
const requestedFlow = new URLSearchParams(window.location.search).get('flow')
const FLOW = requestedFlow === '03' ? '03' : '21'
const DEFAULT_RUNWAY_CONFIG = FLOW === '03' ? '03L / 03R' : '21L / 21R'
`,
`type PublishedAirport = {
  id: string
  icao: string
  name: string
}

type PublishedRunway = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
}

type WorkspacePayload = {
  airports: PublishedAirport[]
  runwayConfigs: PublishedRunway[]
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

function airportShortName(name: string) {
  return name.replace(/ International Airport$| Airport$/i, '')
}
`,
'legacy workspace constants')

  text = replaceOnce(text,
`  const [utcNow, setUtcNow] = useState(new Date())
  const channelRef = useRef<RealtimeChannel | null>(null)`,
`  const [utcNow, setUtcNow] = useState(new Date())
  const [workspace, setWorkspace] = useState<LiveWorkspace | null>(null)
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspacePayload>({ airports: [], runwayConfigs: [] })
  const channelRef = useRef<RealtimeChannel | null>(null)`,
'workspace state')

  text = replaceOnce(text,
`        setLoading(true)
        setError(null)
        const todayUtc = new Date().toISOString().slice(0, 10)

        const { data: existingSession, error: sessionQueryError } = await supabase`,
`        setLoading(true)
        setError(null)

        const workspaceResponse = await fetch('/api/workspaces', { credentials: 'same-origin', cache: 'no-store' })
        if (!workspaceResponse.ok) throw new Error('Unable to load published workspaces')
        const config = await workspaceResponse.json() as WorkspacePayload
        const airportById = new Map(config.airports.map((airport) => [airport.id, airport]))
        const candidates: LiveWorkspace[] = config.runwayConfigs.flatMap((runway) => {
          const airport = airportById.get(runway.airport_id)
          if (!airport) return []
          return [{
            airport: airport.icao,
            airportName: airportShortName(airport.name),
            airportId: airport.id,
            flow: runway.flow,
            runway: runway.label,
            runwayId: runway.id,
            timingReady: runway.timing_status === 'ACTIVE',
          }]
        })
        const selectedWorkspace = candidates.find((item) => item.airport === REQUESTED_AIRPORT && item.flow === REQUESTED_FLOW)
          ?? candidates.find((item) => item.airport === REQUESTED_AIRPORT)
          ?? candidates[0]
        if (!selectedWorkspace) throw new Error('No published arrival workspace is available')
        if (disposed) return
        setWorkspaceConfig(config)
        setWorkspace(selectedWorkspace)

        const canonicalUrl = new URL(window.location.href)
        if (canonicalUrl.searchParams.get('airport') !== selectedWorkspace.airport || canonicalUrl.searchParams.get('flow') !== selectedWorkspace.flow || canonicalUrl.searchParams.get('runway') !== selectedWorkspace.runway) {
          canonicalUrl.searchParams.set('airport', selectedWorkspace.airport)
          canonicalUrl.searchParams.set('flow', selectedWorkspace.flow)
          canonicalUrl.searchParams.set('runway', selectedWorkspace.runway)
          window.history.replaceState(null, '', canonicalUrl.toString())
        }

        const todayUtc = new Date().toISOString().slice(0, 10)

        const { data: existingSession, error: sessionQueryError } = await supabase`,
'workspace bootstrap')

  text = text
    .replace("          .eq('airport', AIRPORT)\n          .eq('flow', FLOW)", "          .eq('airport', selectedWorkspace.airport)\n          .eq('flow', selectedWorkspace.flow)")
    .replace("          .eq('status', 'ACTIVE')\n          .order('created_at'", "          .eq('status', 'ACTIVE')\n          .eq('archived', false)\n          .order('created_at'")
    .replace("              airport: AIRPORT,\n              flow: FLOW,\n              runway_config: DEFAULT_RUNWAY_CONFIG,", "              airport: selectedWorkspace.airport,\n              flow: selectedWorkspace.flow,\n              runway_config: selectedWorkspace.runway,")

  text = replaceOnce(text,
`          if (createSessionError) throw createSessionError
          activeSession = createdSession as SequenceSession`,
`          if (createSessionError) {
            if (createSessionError.code !== '23505') throw createSessionError
            const { data: racedSession, error: racedSessionError } = await supabase
              .from('sequence_sessions')
              .select('*')
              .eq('airport', selectedWorkspace.airport)
              .eq('flow', selectedWorkspace.flow)
              .eq('service_date', todayUtc)
              .eq('status', 'ACTIVE')
              .eq('archived', false)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (racedSessionError) throw racedSessionError
            activeSession = racedSession as SequenceSession | null
          } else {
            activeSession = createdSession as SequenceSession
          }`,
'concurrent session creation')

  text = replaceOnce(text,
`  const deleteFlight = async (row: ArrivalView) => {
    if (!window.confirm(\`Delete \${row.callsign}?\`)) return
    const { error: deleteError } = await supabase.from('arrivals').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
  }

  return (`,
`  const deleteFlight = async (row: ArrivalView) => {
    if (!window.confirm(\`Delete \${row.callsign}?\`)) return
    const { error: deleteError } = await supabase.from('arrivals').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)
  }

  const switchWorkspace = (airport: PublishedAirport, runway: PublishedRunway) => {
    const url = new URL(window.location.href)
    url.searchParams.set('airport', airport.icao)
    url.searchParams.set('flow', runway.flow)
    url.searchParams.set('runway', runway.label)
    window.location.assign(url.toString())
  }

  return (`,
'workspace navigation handler')

  text = text
    .replace('<p>{AIRPORT} · RWY {DEFAULT_RUNWAY_CONFIG} · Shared realtime workspace</p>', '<p>{workspace ? `${workspace.airport} · RWY ${workspace.runway} · Shared realtime workspace` : \'Loading published workspace…\'}</p>')
    .replace('<button className="primary-button" onClick={() => void addFlight()} disabled={!session || fixes.length === 0}>+ Add Flight</button>', '<button className="primary-button" onClick={() => void addFlight()} disabled={!session || !workspace?.timingReady || fixes.length === 0}>+ Add Flight</button>')
    .replace("{fixes.some((fix) => !fix.verified) ? '⚠ VTBD timing values are provisional' : 'Timing dataset verified'}", "{fixes.some((fix) => !fix.verified) ? `⚠ ${workspace?.airport ?? 'Workspace'} timing values are provisional` : 'Timing dataset verified'}")

  text = replaceOnce(text,
`        </section>

        <section className="workspace-card">`,
`        </section>

        {workspace && (
          <section className="sequence-destination-nav" aria-label="Arrival sequencing workspace navigation">
            <div className="destination-nav-row airport-nav-row">
              <div className="destination-nav-heading"><span>AIRPORT</span><strong>Select workspace</strong></div>
              <div className="airport-workspace-tabs">
                {workspaceConfig.airports.map((airport) => {
                  const airportRunways = workspaceConfig.runwayConfigs.filter((runway) => runway.airport_id === airport.id)
                  const firstRunway = airportRunways[0]
                  if (!firstRunway) return null
                  const selected = workspace.airport === airport.icao
                  return <button key={airport.id} type="button" className={\`airport-workspace-button\${selected ? ' is-active' : ''}\`} aria-current={selected ? 'page' : undefined} onClick={() => { if (!selected) switchWorkspace(airport, firstRunway) }}>
                    <span className="airport-workspace-code">{airport.icao}</span>
                    <span className="airport-workspace-name">{airportShortName(airport.name)}</span>
                  </button>
                })}
              </div>
            </div>
            <div className="destination-nav-row runway-nav-row">
              <div className="destination-nav-heading"><span>RUNWAY CONFIGURATION</span><strong>{workspace.airport} arrivals</strong></div>
              <div className="runway-workspace-tabs">
                {workspaceConfig.runwayConfigs.filter((runway) => runway.airport_id === workspace.airportId).map((runway) => {
                  const selected = runway.id === workspace.runwayId
                  const airport = workspaceConfig.airports.find((item) => item.id === runway.airport_id)
                  if (!airport) return null
                  return <button key={runway.id} type="button" className={\`runway-workspace-button \${selected ? 'is-active ' : ''}\${runway.timing_status === 'ACTIVE' ? 'is-ready' : 'is-pending'}\`} aria-current={selected ? 'page' : undefined} onClick={() => { if (!selected) switchWorkspace(airport, runway) }}>
                    <span className="runway-workspace-runway">{runway.label}</span>
                    <small className="runway-workspace-state">{runway.timing_status === 'ACTIVE' ? 'TIMING ACTIVE' : runway.timing_status === 'PENDING' ? 'TIMING PENDING' : 'TIMING DISABLED'}</small>
                  </button>
                })}
              </div>
            </div>
          </section>
        )}

        {workspace && !workspace.timingReady && (
          <div className="timing-pending-banner"><strong>{workspace.airport} {workspace.runway} timing unavailable</strong><span>This published workspace does not have an active timing dataset. Add Flight is disabled until timing is activated in Admin.</span></div>
        )}

        <section className="workspace-card">`,
'react workspace navigation')

  return text
})

console.log('Multi-airport core refactor applied')
