import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import ivaoThailandLogo from './assets/ivao-thailand-logo.png'
import { useAuthUser } from './AuthGate'
import { findAipIawp } from './aipArrivalIawp'
import {
  AMAN_DEFAULT_RUNWAY_SPACING_MINUTES,
  AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES,
  AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES,
  BANGKOK_TMA_WORKING_RADIUS_NM,
  BKK_VOR_COORDINATES,
  VTBD_IAWP_COMPACT_CODES,
  VTBD_IAWP_COMPACT_CODE_STYLE,
  VTBD_IAWP_NOMINAL_MINUTES,
  VTBS_STAR19_NOMINAL_MINUTES,
} from './core/amanConstants'
import { readIvaoTraffic, readRouteGeometry, type IvaoArrivalTrafficFlight } from './core/api'
import { estimateIawpArrival, type RouteGeometry } from './core/arrivalEta'
import {
  autoSequenceUnstableArrivals,
  averageDelayMinutes,
  type AmanArrivalPrediction,
  type AmanSequenceRow,
} from './core/arrivalSequencing'

type AirportCode = 'VTBD' | 'VTBS'

type InboundPreview = {
  flight: IvaoArrivalTrafficFlight
  refFix: string | null
  predictedIawpAt: string | null
  source: string
  reason: string | null
}

type DisplayInboundRow = {
  id: string
  callsign: string
  aircraft: string
  refFix: string
  eta: string | null
  title: string
}

type DemoSpec = {
  callsign: string
  aircraftType: string
  wakeTurbulence: string
  refFix: string
  naturalLandingOffsetMinutes: number
}

const RUNWAYS: Record<AirportCode, readonly string[]> = {
  VTBD: ['21R', '21L'],
  VTBS: ['19', '20L', '20R'],
}

const ENTRY_FIXES: Record<AirportCode, readonly string[]> = {
  VTBD: ['WEHHA', 'NAKON', 'ENDUU', 'SEHNA', 'SABAI'],
  VTBS: ['WILLA', 'NORTA', 'EASTE', 'TUMGA', 'LEBIM'],
}

const DEMO_SPECS: Record<AirportCode, readonly DemoSpec[]> = {
  VTBD: [
    { callsign: 'THA101', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'WEHHA', naturalLandingOffsetMinutes: 8 },
    { callsign: 'AIQ202', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'NAKON', naturalLandingOffsetMinutes: 8.5 },
    { callsign: 'BKP303', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'ENDUU', naturalLandingOffsetMinutes: 9 },
    { callsign: 'TVJ404', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'SABAI', naturalLandingOffsetMinutes: 9.5 },
    { callsign: 'HVN505', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'SEHNA', naturalLandingOffsetMinutes: 10 },
    { callsign: 'THA606', aircraftType: 'A388', wakeTurbulence: 'J', refFix: 'WEHHA', naturalLandingOffsetMinutes: 11 },
    { callsign: 'AIQ707', aircraftType: 'AT76', wakeTurbulence: 'M', refFix: 'NAKON', naturalLandingOffsetMinutes: 13 },
    { callsign: 'KMI808', aircraftType: 'B763', wakeTurbulence: 'H', refFix: 'ENDUU', naturalLandingOffsetMinutes: 16 },
  ],
  VTBS: [
    { callsign: 'THA111', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'WILLA', naturalLandingOffsetMinutes: 8 },
    { callsign: 'AIQ222', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'NORTA', naturalLandingOffsetMinutes: 8.5 },
    { callsign: 'BKP333', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'EASTE', naturalLandingOffsetMinutes: 9 },
    { callsign: 'TVJ444', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'TUMGA', naturalLandingOffsetMinutes: 9.5 },
    { callsign: 'HVN555', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'LEBIM', naturalLandingOffsetMinutes: 10 },
    { callsign: 'THA666', aircraftType: 'A388', wakeTurbulence: 'J', refFix: 'WILLA', naturalLandingOffsetMinutes: 11 },
    { callsign: 'AIQ777', aircraftType: 'AT76', wakeTurbulence: 'M', refFix: 'NORTA', naturalLandingOffsetMinutes: 13 },
    { callsign: 'KMI888', aircraftType: 'B763', wakeTurbulence: 'H', refFix: 'EASTE', naturalLandingOffsetMinutes: 16 },
  ],
}

const PX_PER_MINUTE = 10
const TIMELINE_PAST_MINUTES = 22
const TIMELINE_FUTURE_MINUTES = 58
const routeGeometryCache = new Map<string, Promise<RouteGeometry | null>>()

function formatUtc(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`
}

function formatHm(value: string | null) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function formatDelay(minutes: number) {
  const rounded = Math.round(minutes * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}`
}

function nominalStarSeconds(airport: AirportCode, fix: string) {
  if (airport === 'VTBD') {
    const minutes = (VTBD_IAWP_NOMINAL_MINUTES as Record<string, number>)[fix]
    return Number.isFinite(minutes) ? minutes * 60 : null
  }
  const minutes = (VTBS_STAR19_NOMINAL_MINUTES as Record<string, number>)[fix]
  return Number.isFinite(minutes) ? minutes * 60 : null
}

function compactFix(airport: AirportCode, fix: string) {
  if (airport === 'VTBD') {
    return (VTBD_IAWP_COMPACT_CODES as Record<string, string>)[fix] || fix.slice(0, 1)
  }
  return fix.slice(0, 1)
}

function compactFixClass(airport: AirportCode, fix: string) {
  if (airport !== 'VTBD') return ''
  return (VTBD_IAWP_COMPACT_CODE_STYLE as Record<string, string>)[fix] === 'UNDERLINE'
    ? 'is-underlined'
    : ''
}

function timelineTicks(now: Date) {
  const anchor = new Date(now)
  anchor.setUTCSeconds(0, 0)

  return Array.from(
    { length: TIMELINE_PAST_MINUTES + TIMELINE_FUTURE_MINUTES + 1 },
    (_, index) => {
      const tick = new Date(anchor.getTime() + (index - TIMELINE_PAST_MINUTES) * 60_000)
      const offsetMinutes = (tick.getTime() - now.getTime()) / 60_000
      return {
        key: tick.toISOString(),
        label: formatHm(tick.toISOString()),
        isMajor: tick.getUTCMinutes() % 5 === 0,
        offsetPx: Math.round(-offsetMinutes * PX_PER_MINUTE),
      }
    },
  )
}

function routeKey(flight: IvaoArrivalTrafficFlight, airport: AirportCode) {
  if (!flight.departure || !flight.route) return null
  return `${flight.departure}|${airport}|${flight.route}`
}

function resolveRouteGeometry(flight: IvaoArrivalTrafficFlight, airport: AirportCode) {
  const key = routeKey(flight, airport)
  if (!key || !flight.departure || !flight.route) return Promise.resolve<RouteGeometry | null>(null)

  const existing = routeGeometryCache.get(key)
  if (existing) return existing

  const request = readRouteGeometry<RouteGeometry>(flight.departure, airport, flight.route)
    .catch(() => {
      routeGeometryCache.delete(key)
      return null
    })

  routeGeometryCache.set(key, request)
  return request
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => value * Math.PI / 180
  const earthRadiusNm = 3440.065
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function buildDemoPredictions(airport: AirportCode, runway: string, anchor: Date) {
  return DEMO_SPECS[airport].flatMap<AmanArrivalPrediction>((spec, index) => {
    const nominalSeconds = nominalStarSeconds(airport, spec.refFix)
    if (nominalSeconds == null) return []

    const naturalLandingMs = anchor.getTime() + spec.naturalLandingOffsetMinutes * 60_000
    const predictedIawpMs = naturalLandingMs - nominalSeconds * 1000

    return [{
      id: `demo-${airport}-${index}`,
      callsign: spec.callsign,
      aircraftType: spec.aircraftType,
      wakeTurbulence: spec.wakeTurbulence,
      runway,
      refFix: spec.refFix,
      predictedIawpAt: new Date(predictedIawpMs).toISOString(),
      nominalStarSeconds: nominalSeconds,
    }]
  })
}

export default function App() {
  const user = useAuthUser()
  const [now, setNow] = useState(() => new Date())
  const [airport, setAirport] = useState<AirportCode>('VTBD')
  const [runway, setRunway] = useState('21R')
  const [historyMinutes, setHistoryMinutes] = useState(AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES)
  const [inbound, setInbound] = useState<InboundPreview[]>([])
  const [sequence, setSequence] = useState<AmanSequenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoAnchor, setDemoAnchor] = useState<Date | null>(null)

  const ticks = useMemo(() => timelineTicks(now), [now])
  const liveRouteCount = useMemo(
    () => inbound.filter((item) => item.source === 'LIVE_ROUTE').length,
    [inbound],
  )
  const liveTmaCount = useMemo(
    () => inbound.filter(({ flight }) => {
      if (!Number.isFinite(flight.latitude) || !Number.isFinite(flight.longitude)) return false
      return distanceNm(
        BKK_VOR_COORDINATES.lat,
        BKK_VOR_COORDINATES.lon,
        flight.latitude as number,
        flight.longitude as number,
      ) <= BANGKOK_TMA_WORKING_RADIUS_NM
    }).length,
    [inbound],
  )

  const demoSequence = useMemo(() => {
    if (!demoMode || !demoAnchor) return []
    const spacingMinutes = (
      AMAN_DEFAULT_RUNWAY_SPACING_MINUTES[airport] as Record<string, number>
    )[runway]
    if (!Number.isFinite(spacingMinutes)) return []

    return autoSequenceUnstableArrivals(
      buildDemoPredictions(airport, runway, demoAnchor),
      { runwaySpacingSeconds: { [runway]: spacingMinutes * 60 } },
    )
  }, [airport, demoAnchor, demoMode, runway])

  const activeSequence = demoMode ? demoSequence : sequence
  const averageDelay = useMemo(() => averageDelayMinutes(activeSequence), [activeSequence])
  const visibleSequence = useMemo(() => {
    const cutoff = now.getTime() - historyMinutes * 60_000
    return activeSequence.filter((row) => new Date(row.tldt).getTime() >= cutoff)
  }, [activeSequence, historyMinutes, now])

  const displayInboundRows = useMemo<DisplayInboundRow[]>(() => {
    if (demoMode) {
      return demoSequence.map((row) => ({
        id: row.id,
        callsign: row.callsign,
        aircraft: row.aircraftType || '----',
        refFix: row.refFix,
        eta: row.predictedIawpAt,
        title: 'SIMULATED TEST TRAFFIC',
      }))
    }

    return inbound.map((item) => ({
      id: item.flight.sessionId,
      callsign: item.flight.callsign,
      aircraft: item.flight.aircraft || '----',
      refFix: item.refFix || '----',
      eta: item.predictedIawpAt,
      title: `${item.source}${item.reason ? ` · ${item.reason}` : ''}`,
    }))
  }, [demoMode, demoSequence, inbound])

  const displayTmaCount = demoMode ? Math.min(4, demoSequence.length) : liveTmaCount
  const displayTotCount = demoMode ? demoSequence.length : inbound.length

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setRunway(RUNWAYS[airport][0])
  }, [airport])

  useEffect(() => {
    let disposed = false

    const loadTraffic = async () => {
      try {
        const payload = await readIvaoTraffic(airport)
        const flights = payload.flights ?? []

        const resolved = await Promise.all(flights.map(async (flight) => {
          const match = findAipIawp(airport, flight.route, [...ENTRY_FIXES[airport]])
          if (!match) {
            return {
              preview: {
                flight,
                refFix: null,
                predictedIawpAt: null,
                source: 'UNRESOLVED',
                reason: 'IAWP not resolved from filed route',
              } satisfies InboundPreview,
              prediction: null,
            }
          }

          const nominalSeconds = nominalStarSeconds(airport, match.entryFix)
          if (nominalSeconds == null) {
            return {
              preview: {
                flight,
                refFix: match.entryFix,
                predictedIawpAt: null,
                source: 'NO TIMING',
                reason: 'No nominal STAR timing configured',
              } satisfies InboundPreview,
              prediction: null,
            }
          }

          const geometry = await resolveRouteGeometry(flight, airport)
          const eta = estimateIawpArrival(
            flight,
            geometry,
            match.entryFix,
            nominalSeconds,
            payload.fetchedAt,
          )

          const preview = {
            flight,
            refFix: match.entryFix,
            predictedIawpAt: eta.predictedIawpAt,
            source: eta.source,
            reason: eta.reason,
          } satisfies InboundPreview

          const prediction: AmanArrivalPrediction | null = eta.predictedIawpAt
            ? {
                id: flight.sessionId,
                callsign: flight.callsign,
                aircraftType: flight.aircraft,
                wakeTurbulence: flight.wakeTurbulence,
                runway,
                refFix: match.entryFix,
                predictedIawpAt: eta.predictedIawpAt,
                nominalStarSeconds: nominalSeconds,
              }
            : null

          return { preview, prediction }
        }))

        const previews = resolved.map((item) => item.preview)
        const predictions = resolved
          .map((item) => item.prediction)
          .filter((item): item is AmanArrivalPrediction => item !== null)

        const spacingMinutes = (
          AMAN_DEFAULT_RUNWAY_SPACING_MINUTES[airport] as Record<string, number>
        )[runway]

        const rows = Number.isFinite(spacingMinutes)
          ? autoSequenceUnstableArrivals(predictions, {
              runwaySpacingSeconds: { [runway]: spacingMinutes * 60 },
            })
          : []

        if (!disposed) {
          setInbound(
            previews.sort((a, b) =>
              (a.predictedIawpAt || '9999').localeCompare(b.predictedIawpAt || '9999'),
            ),
          )
          setSequence(rows)
          setFetchedAt(payload.fetchedAt)
          setTrafficError(null)
          setLoading(false)
        }
      } catch (error) {
        if (!disposed) {
          setTrafficError(error instanceof Error ? error.message : String(error))
          setLoading(false)
        }
      }
    }

    void loadTraffic()
    const refresh = window.setInterval(() => void loadTraffic(), 30_000)
    return () => {
      disposed = true
      window.clearInterval(refresh)
    }
  }, [airport, runway])

  const toggleDemo = () => {
    if (demoMode) {
      setDemoMode(false)
      setDemoAnchor(null)
      return
    }
    setDemoAnchor(new Date())
    setDemoMode(true)
  }

  return (
    <div className="aman-app">
      <header className="aman-topbar">
        <div className="aman-brand">
          <img src={ivaoThailandLogo} alt="IVAO Thailand" />
          <div className="aman-brand-copy">
            <span>Thailand Approach AMAN</span>
            <strong>Arrival Sequencing</strong>
          </div>
        </div>

        <div className="aman-session">
          <div className="aman-clock">
            <span>UTC</span>
            <strong>{formatUtc(now)}</strong>
          </div>
          <div className="aman-user">
            <strong>{user.name}</strong>
            <span>VID {user.vid}</span>
          </div>
          <a className="aman-signout" href="/api/auth/logout">Sign out</a>
        </div>
      </header>

      <section className="aman-control-strip">
        <div className="aman-airport-tabs" aria-label="Airport selector">
          {(['VTBD', 'VTBS'] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={airport === code ? 'is-active' : ''}
              onClick={() => setAirport(code)}
            >
              {code}
            </button>
          ))}
        </div>

        <div className="aman-runway-control">
          <span>PREVIEW RUNWAY</span>
          <select value={runway} onChange={(event) => setRunway(event.target.value)}>
            {RUNWAYS[airport].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        <div className="aman-config-label">
          <span>APPROACH VIEW</span>
          <strong>{airport} · RWY {runway} · {demoMode ? 'SIMULATED TEST SEQUENCE' : 'AUTO UNSTABLE SEQUENCE'}</strong>
        </div>

        <div className="aman-counters">
          <div><span>TMA</span><strong>{String(displayTmaCount).padStart(3, '0')}</strong></div>
          <div><span>TOT</span><strong>{String(displayTotCount).padStart(3, '0')}</strong></div>
          <div><span>HLD</span><strong>---</strong></div>
          <div><span>ΔT</span><strong>{activeSequence.length ? formatDelay(averageDelay) : '--'}</strong></div>
        </div>
      </section>

      <main className="aman-workspace">
        <section className="aman-panel aman-timeline-panel">
          <div className="aman-panel-header">
            <div>
              <span className="aman-eyebrow">MAESTRO STYLE</span>
              <h1>Arrival Timeline</h1>
            </div>
            <div className="aman-panel-meta">
              <span>5 MIN MAJOR</span>
              <span>1 MIN MINOR</span>
              <label className="aman-history-control">
                <span>HISTORY</span>
                <select
                  value={historyMinutes}
                  onChange={(event) => setHistoryMinutes(Number(event.target.value))}
                >
                  {AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES.map((value) => (
                    <option key={value} value={value}>{value} MIN</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`aman-demo-toggle ${demoMode ? 'is-active' : ''}`}
                onClick={toggleDemo}
              >
                {demoMode ? 'TEST TRAFFIC ON' : 'TEST TRAFFIC'}
              </button>
              <span className={demoMode ? 'is-simulated' : ''}>
                {demoMode ? 'SIMULATED' : loading ? 'LOADING' : 'IVAO LIVE'}
              </span>
            </div>
          </div>

          <div className="aman-timeline-stage">
            <div className="aman-time-axis" aria-hidden="true">
              {ticks.map((tick) => (
                <div
                  className={`aman-minute-tick ${tick.isMajor ? 'is-major' : 'is-minor'}`}
                  key={tick.key}
                  style={{ '--offset-px': `${tick.offsetPx}px` } as CSSProperties}
                >
                  {tick.isMajor && <span>{tick.label}</span>}
                  <i />
                </div>
              ))}
            </div>

            <div className="aman-current-line">
              <span>ACTUAL {formatUtc(now)}</span>
            </div>

            <div className="aman-flight-layer">
              {visibleSequence.map((row) => {
                const offsetMinutes = (new Date(row.tldt).getTime() - now.getTime()) / 60_000
                const isPast = offsetMinutes < 0
                const offsetPx = Math.round(-offsetMinutes * PX_PER_MINUTE)
                return (
                  <div
                    key={row.id}
                    className={`aman-flight-row action-${row.delayAction.toLowerCase()}${isPast ? ' is-past' : ''}${demoMode ? ' is-demo' : ''}`}
                    style={{ '--offset-px': `${offsetPx}px` } as CSSProperties}
                    title={`Predicted IAWP ${formatHm(row.predictedIawpAt)}Z · TLDT ${formatHm(row.tldt)}Z · Delay ${formatDelay(row.delayMinutes)} min${isPast ? ' · assumed landed' : ''}`}
                  >
                    <span className="tldt">{formatHm(row.tldt)}</span>
                    <strong>{row.callsign}</strong>
                    <span>{row.aircraftType || '----'}</span>
                    <span className={`fix-code ${compactFixClass(airport, row.refFix)}`}>
                      {compactFix(airport, row.refFix)}
                    </span>
                    <span>{formatHm(row.tto)}</span>
                    <b>{formatDelay(row.delayMinutes)}</b>
                    <em>{row.runway}</em>
                  </div>
                )
              })}
            </div>

            {!loading && !visibleSequence.length && !demoMode && (
              <div className="aman-empty-sequence">
                <strong>{trafficError ? 'LIVE TRAFFIC ERROR' : 'NO SEQUENCEABLE INBOUND'}</strong>
                <span>
                  {trafficError || 'No live inbound right now. Use TEST TRAFFIC to verify the timeline and sequencing UI.'}
                </span>
              </div>
            )}
          </div>
        </section>

        <aside className="aman-side-stack">
          <section className="aman-panel aman-inbound-panel">
            <div className="aman-panel-header compact">
              <div>
                <span className="aman-eyebrow">TRAFFIC</span>
                <h2>Inbound</h2>
              </div>
              <span className={`aman-live-pill ${trafficError ? 'is-error' : ''} ${demoMode ? 'is-demo' : ''}`}>
                {demoMode ? 'TEST DATA' : trafficError ? 'API ERROR' : 'IVAO LIVE'}
              </span>
            </div>

            <div className="aman-inbound-list">
              <div className="aman-inbound-head">
                <span>ACID</span><span>TYPE</span><span>IAWP</span><span>ETA</span>
              </div>
              {displayInboundRows.map((item) => (
                <div className="aman-inbound-row" key={item.id} title={item.title}>
                  <strong>{item.callsign}</strong>
                  <span>{item.aircraft}</span>
                  <span>{item.refFix}</span>
                  <span>{formatHm(item.eta)}</span>
                </div>
              ))}
              {!loading && !displayInboundRows.length && <p>No connected inbound traffic for {airport}.</p>}
            </div>
          </section>

          <section className="aman-panel aman-system-panel">
            <div className="aman-panel-header compact">
              <div>
                <span className="aman-eyebrow">SYSTEM</span>
                <h2>Pipeline</h2>
              </div>
            </div>
            <dl className="aman-status-list">
              <div><dt>Data mode</dt><dd>{demoMode ? 'SIMULATED' : 'LIVE'}</dd></div>
              <div><dt>IVAO inbound</dt><dd>{trafficError ? 'ERROR' : 'LIVE'}</dd></div>
              <div><dt>IAWP mapping</dt><dd>ACTIVE</dd></div>
              <div><dt>Live route ETA</dt><dd>{liveRouteCount}/{inbound.length}</dd></div>
              <div><dt>Fallback ETA</dt><dd>ACTUAL / EOBT</dd></div>
              <div><dt>TMA model</dt><dd>50 NM BKK</dd></div>
              <div><dt>Sequence</dt><dd>AUTO UNSTABLE</dd></div>
              <div><dt>Last update</dt><dd>{formatHm(fetchedAt)}Z</dd></div>
            </dl>
          </section>
        </aside>
      </main>

      <footer className="aman-legend">
        <span>DELAY</span>
        <i className="expedite" /> Expedite
        <i className="nothing" /> Nothing
        <i className="speed" /> Speed reduction
        <i className="stretch" /> Path stretching
        <i className="holding" /> Holding
      </footer>
    </div>
  )
}
