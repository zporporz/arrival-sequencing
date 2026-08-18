import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useAuthUser } from './AuthGate'

type AirportCode = 'VTBD' | 'VTBS'

function formatUtc(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`
}

function floorToFiveMinutes(date: Date) {
  const copy = new Date(date)
  copy.setUTCSeconds(0, 0)
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / 5) * 5)
  return copy
}

function timelineTicks(now: Date) {
  const anchor = floorToFiveMinutes(now)
  return Array.from({ length: 12 }, (_, index) => {
    const tick = new Date(anchor.getTime() + (index - 2) * 5 * 60_000)
    return {
      key: tick.toISOString(),
      label: `${String(tick.getUTCHours()).padStart(2, '0')}:${String(tick.getUTCMinutes()).padStart(2, '0')}`,
      offset: index - 2,
    }
  })
}

export default function App() {
  const user = useAuthUser()
  const [now, setNow] = useState(() => new Date())
  const [airport, setAirport] = useState<AirportCode>('VTBD')
  const ticks = useMemo(() => timelineTicks(now), [now])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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

        <div className="aman-config-label">
          <span>APPROACH VIEW</span>
          <strong>{airport} · RUNWAY CONFIG PENDING</strong>
        </div>

        <div className="aman-counters">
          <div><span>TMA</span><strong>---</strong></div>
          <div><span>TOT</span><strong>---</strong></div>
          <div><span>HLD</span><strong>---</strong></div>
          <div><span>ΔT</span><strong>--:--</strong></div>
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
              <span>READ ONLY</span>
            </div>
          </div>

          <div className="aman-timeline-stage">
            <div className="aman-time-axis" aria-hidden="true">
              {ticks.map((tick) => (
                <div className="aman-major-tick" key={tick.key} style={{ '--tick-index': tick.offset } as CSSProperties}>
                  <span>{tick.label}</span>
                  <i />
                </div>
              ))}
            </div>

            <div className="aman-current-line">
              <span>ACTUAL {formatUtc(now)}</span>
            </div>

            <div className="aman-empty-sequence">
              <strong>LIVE SEQUENCE PIPELINE NEXT</strong>
              <span>IVAO inbound → IAWP ETA → TLDT / TTO / Delay → timeline</span>
            </div>
          </div>
        </section>

        <aside className="aman-side-stack">
          <section className="aman-panel aman-inbound-panel">
            <div className="aman-panel-header compact">
              <div>
                <span className="aman-eyebrow">TRAFFIC</span>
                <h2>Inbound</h2>
              </div>
              <span className="aman-live-pill">IVAO LIVE</span>
            </div>
            <div className="aman-placeholder-list">
              <div><span>ACID</span><span>TYPE</span><span>IAWP</span><span>ETA</span></div>
              <p>No traffic loaded into the new view yet.</p>
            </div>
          </section>

          <section className="aman-panel aman-system-panel">
            <div className="aman-panel-header compact">
              <div>
                <span className="aman-eyebrow">SYSTEM</span>
                <h2>Rebuild Status</h2>
              </div>
            </div>
            <dl className="aman-status-list">
              <div><dt>IVAO API</dt><dd>READY</dd></div>
              <div><dt>ETA Engine</dt><dd>READY</dd></div>
              <div><dt>Sequence Engine</dt><dd>READY</dd></div>
              <div><dt>Timeline Data</dt><dd>NEXT</dd></div>
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
