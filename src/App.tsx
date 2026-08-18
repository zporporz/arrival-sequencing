import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useAuthUser } from './AuthGate'
import { findAipIawp } from './aipArrivalIawp'
import {
  AMAN_DEFAULT_RUNWAY_SPACING_MINUTES,
  VTBD_IAWP_COMPACT_CODES,
  VTBD_IAWP_COMPACT_CODE_STYLE,
  VTBD_IAWP_NOMINAL_MINUTES,
  VTBS_STAR19_NOMINAL_MINUTES,
} from './core/amanConstants'
import { readIvaoTraffic, type IvaoArrivalTrafficFlight } from './core/api'
import { estimateIawpArrival } from './core/arrivalEta'
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

const RUNWAYS: Record<AirportCode, readonly string[]> = {
  VTBD: ['21R', '21L'],
  VTBS: ['19', '20L', '20R'],
}

const ENTRY_FIXES: Record<AirportCode, readonly string[]> = {
  VTBD: ['WEHHA', 'NAKON', 'ENDUU', 'SEHNA', 'SABAI'],
  VTBS: ['WILLA', 'NORTA', 'EASTE', 'TUMGA', 'LEBIM'],
}

const PX_PER_MINUTE = 22

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
  anchor.setUTCMinutes(Math.floor(anchor.getUTCMinutes() / 5) * 5)
  return Array.from({ length: 15 }, (_, index) => {
    const tick = new Date(anchor.getTime() + (index - 5) * 5 * 60_000)
    return {
      key: tick.toISOString(),
      label: formatHm(tick.toISOString()),
      offsetMinutes: (tick.getTime() - now.getTime()) / 60_000,
    }
  })
}

export default function App() {
  const user = useAuthUser()
  const [now, setNow] = useState(() => new Date())
  const [airport, setAirport] = useState<AirportCode>('VTBD')
  const [runway, setRunway] = useState('21R')
  const [inbound, setInbound] = useState<InboundPreview[]>([])
  const [sequence, setSequence] = useState<AmanSequenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const ticks = useMemo(() => timelineTicks(now), [now])
  const averageDelay = useMemo(() => averageDelayMinutes(sequence), [sequence])

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
        const previews: InboundPreview[] = []
        const predictions: AmanArrivalPrediction[] = []

        for (const flight of flights) {
          const match = findAipIawp(airport, flight.route, [...ENTRY_FIXES[airport]])
          if (!match) {
            previews.push({
              flight,
              refFix: null,
              predictedIawpAt: null,
              source: 'UNRESOLVED',
              reason: 'IAWP not resolved from filed route',
            })
            continue
          }

          const nominalSeconds = nominalStarSeconds(airport, match.entryFix)
          if (nominalSeconds == null) {
            previews.push({
              flight,
              refFix: match.entryFix,
              predictedIawpAt: null,
              source: 'NO TIMING',
              reason: 'No nominal STAR timing configured',
            })
            continue
          }

          const eta = estimateIawpArrival(
            flight,
            null,
            match.entryFix,
            nominalSeconds,
            payload.fetchedAt,
          )

          previews.push({
            flight,
            refFix: match.entryFix,
            predictedIawpAt: eta.predictedIawpAt,
            source: eta.source,
            reason: eta.reason,
          })

          if (eta.predictedIawpAt) {
            predictions.push({
              id: flight.sessionId,
              callsign: flight.callsign,
              aircraftType: flight.aircraft,
              wakeTurbulence: flight.wakeTurbulence,
              runway,
              refFix: match.entryFix,
              predictedIawpAt: eta.predictedIawpAt,
              nominalStarSeconds: nominalSeconds,
            })
          }
        }

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

  return (
    <div className="aman-app">
      <header className="aman-topbar">
        <div className="aman-brand">
          <img src="/assets/ivao-thailand-logo.png" alt="IVAO Thailand" />
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
          <strong>{airport} · RWY {runway} · AUTO UNSTABLE SEQUENCE</strong>
        </div>

        <div className="aman-counters">
          <div><span>TMA</span><strong>---</strong></div>
          <div><span>TOT</span><strong>{String(inbound.length).padStart(3, '0')}</strong></div>
          <div><span>HLD</span><strong>---</strong></div>
          <div><span>ΔT</span><strong>{sequence.length ? formatDelay(averageDelay) : '--'}</strong></div>
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
              <span>{loading ? 'LOADING' : 'IVAO LIVE'}</span>
            </div>
          </div>

          <div className="aman-timeline-stage">
            <div className="aman-time-axis" aria-hidden="true">
              {ticks.map((tick) => (
                <div
                  className="aman-major-tick"
                  key={tick.key}
                  style={{ '--offset-px': `${-tick.offsetMinutes * PX_PER_MINUTE}px` } as CSSProperties}
                >
                  <span>{tick.label}</span>
                  <i />
                </div>
              ))}
            </div>

            <div className="aman-current-line">
              <span>ACTUAL {formatUtc(now)}</span>
            </div>

            <div className="aman-flight-layer">
              {sequence.map((row) => {
                const offsetMinutes = (new Date(row.tldt).getTime() - now.getTime()) / 60_000
                return (
                  <div
                    key={row.id}
                    className={`aman-flight-row action-${row.delayAction.toLowerCase()}`}
                    style={{ '--offset-px': `${-offsetMinutes * PX_PER_MINUTE}px` } as CSSProperties}
                    title={`Predicted IAWP ${formatHm(row.predictedIawpAt)}Z · TLDT ${formatHm(row.tldt)}Z · Delay ${formatDelay(row.delayMinutes)} min`}
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

            {!loading && !sequence.length && (
              <div className="aman-empty-sequence">
                <strong>{trafficError ? 'LIVE TRAFFIC ERROR' : 'NO SEQUENCEABLE INBOUND'}</strong>
                <span>
                  {trafficError || 'Inbound may be empty, IAWP may be unresolved, or nominal timing may be unavailable.'}
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
              <span className={`aman-live-pill ${trafficError ? 'is-error' : ''}`}>
                {trafficError ? 'API ERROR' : 'IVAO LIVE'}
              </span>
            </div>

            <div className="aman-inbound-list">
              <div className="aman-inbound-head">
                <span>ACID</span><span>TYPE</span><span>IAWP</span><span>ETA</span>
              </div>
              {inbound.map((item) => (
                <div className="aman-inbound-row" key={item.flight.sessionId} title={item.reason || item.source}>
                  <strong>{item.flight.callsign}</strong>
                  <span>{item.flight.aircraft || '----'}</span>
                  <span>{item.refFix || '----'}</span>
                  <span>{formatHm(item.predictedIawpAt)}</span>
                </div>
              ))}
              {!loading && !inbound.length && <p>No connected inbound traffic for {airport}.</p>}
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
              <div><dt>IVAO inbound</dt><dd>{trafficError ? 'ERROR' : 'LIVE'}</dd></div>
              <div><dt>IAWP mapping</dt><dd>ACTIVE</dd></div>
              <div><dt>ETA source</dt><dd>FPL / ACTUAL</dd></div>
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
