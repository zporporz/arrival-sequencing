type Arrival = {
  seq: number
  callsign: string
  aircraft: string
  dep: string
  refFix: string
  eto: string
  eldt: string
  cldt: string
  cto: string
  aldt: string
  variance: string
  status: 'LANDING' | 'SEQUENCED' | 'LANDED'
}

const arrivals: Arrival[] = [
  { seq: 1, callsign: 'TLM8813', aircraft: 'B738', dep: 'ZJSY', refFix: 'UBLOD', eto: '11:12', eldt: '11:31', cldt: '11:31', cto: '11:12', aldt: '11:27', variance: '-00:04', status: 'LANDED' },
  { seq: 2, callsign: 'BKP454', aircraft: 'AT76', dep: 'VTSM', refFix: 'HOTEL', eto: '11:13', eldt: '11:34', cldt: '11:34', cto: '11:13', aldt: '11:36', variance: '+00:02', status: 'LANDED' },
  { seq: 3, callsign: 'SWI768', aircraft: 'B77W', dep: 'VOMM', refFix: 'IBETO', eto: '11:40', eldt: '12:00', cldt: '12:00', cto: '11:40', aldt: '11:59', variance: '-00:01', status: 'LANDED' },
  { seq: 4, callsign: 'CPA751', aircraft: 'B77W', dep: 'VHHH', refFix: 'UBLOD', eto: '11:50', eldt: '12:09', cldt: '12:09', cto: '11:50', aldt: '12:07', variance: '-00:02', status: 'LANDED' },
  { seq: 5, callsign: 'SIA419', aircraft: 'B77W', dep: 'WSSS', refFix: 'SEHNA', eto: '11:48', eldt: '12:13', cldt: '12:13', cto: '11:48', aldt: '12:11', variance: '-00:02', status: 'LANDED' },
  { seq: 6, callsign: 'THA771', aircraft: 'A346', dep: 'VHHH', refFix: 'UBLOD', eto: '12:10', eldt: '12:29', cldt: '12:31', cto: '12:12', aldt: '—', variance: '—', status: 'SEQUENCED' },
]

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">THAILAND APPROACH TOOLS</div>
          <h1>VTBD Arrival Sequencing</h1>
          <p>Flow 21 · Realtime planning workspace</p>
        </div>
        <div className="topbar-actions">
          <div className="clock-card"><span>UTC</span><strong>11:15:42</strong></div>
          <button className="secondary-button">Flow 21 ▾</button>
          <button className="primary-button">+ Add Flight</button>
        </div>
      </header>

      <main className="content">
        <section className="summary-grid">
          <article className="summary-card"><span>Flights in sequence</span><strong>26</strong><small>Active traffic</small></article>
          <article className="summary-card"><span>Next landing</span><strong>12:10</strong><small>THA771</small></article>
          <article className="summary-card"><span>Average interval</span><strong>02:05</strong><small>Target ≥ 02:00</small></article>
          <article className="summary-card"><span>Controllers online</span><strong>3</strong><small>Realtime connected</small></article>
        </section>

        <section className="workspace-card">
          <div className="workspace-toolbar">
            <div>
              <h2>Arrival sequence</h2>
              <p>Click editable cells to update the shared sequence.</p>
            </div>
            <div className="toolbar-controls">
              <input aria-label="Search flights" placeholder="Search callsign, aircraft or fix…" />
              <button className="secondary-button">All fixes ▾</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SEQ</th><th>CALLSIGN</th><th>A/C</th><th>DEP</th><th>REF FIX</th><th>ETO</th><th>ELDT</th><th>CLDT</th><th>CTO</th><th>ALDT</th><th>SEQ VAR</th><th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {arrivals.map((flight) => (
                  <tr key={flight.callsign} className={flight.status === 'SEQUENCED' ? 'active-row' : ''}>
                    <td className="seq-cell">{flight.seq}</td>
                    <td className="callsign-cell">{flight.callsign}</td>
                    <td>{flight.aircraft}</td>
                    <td>{flight.dep}</td>
                    <td><span className={`fix-pill fix-${flight.refFix.toLowerCase()}`}>{flight.refFix}</span></td>
                    <td className="editable-cell">{flight.eto}</td>
                    <td className="computed-cell">{flight.eldt}</td>
                    <td className="editable-cell cldt-cell">{flight.cldt}</td>
                    <td className="computed-cell">{flight.cto}</td>
                    <td className="editable-cell">{flight.aldt}</td>
                    <td className={flight.variance.startsWith('+') ? 'positive-var' : 'negative-var'}>{flight.variance}</td>
                    <td><span className={`status status-${flight.status.toLowerCase()}`}>{flight.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="workspace-footer">
            <div className="legend"><span><i className="dot editable-dot" /> Editable</span><span><i className="dot computed-dot" /> Auto-calculated</span></div>
            <div>Last synced just now · <strong className="live">● LIVE</strong></div>
          </footer>
        </section>
      </main>
    </div>
  )
}

export default App
