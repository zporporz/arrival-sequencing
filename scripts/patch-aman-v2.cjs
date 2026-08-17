const fs = require('fs')

function replace(path, from, to) {
  let text = fs.readFileSync(path, 'utf8')
  if (!text.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0, 180)}`)
  text = text.replace(from, to)
  fs.writeFileSync(path, text)
}

function replaceRegex(path, regex, to, label) {
  let text = fs.readFileSync(path, 'utf8')
  if (!regex.test(text)) throw new Error(`Regex pattern not found in ${path}: ${label}`)
  text = text.replace(regex, to)
  fs.writeFileSync(path, text)
}

replace(
  'src/main.tsx',
  `import './sessionAdmin.css'`,
  `import './sessionAdmin.css'\nimport './amanV2.css'`,
)

replace(
  'src/App.tsx',
  `import IvaoTrafficPanel, { type TrafficAddItem, type TrafficFlight } from './IvaoTrafficPanel'`,
  `import IvaoTrafficPanel, { type TrafficAddItem, type TrafficFlight } from './IvaoTrafficPanel'\nimport AmanTrafficSummary from './AmanTrafficSummary'`,
)

replace(
  'src/App.tsx',
  `const compactStaffPosition = (value: string) => {`,
  `const amanDelayMinutes = (target: string, estimate: string) => {\n  const targetMs = new Date(target).getTime()\n  const estimateMs = new Date(estimate).getTime()\n  if (!Number.isFinite(targetMs) || !Number.isFinite(estimateMs)) return null\n  let minutes = Math.round((targetMs - estimateMs) / 60_000)\n  if (minutes > 720) minutes -= 1440\n  if (minutes < -720) minutes += 1440\n  return minutes\n}\n\nconst amanDelayLabel = (minutes: number | null) => {\n  if (minutes == null) return '—'\n  if (minutes > 0) return \`+\${minutes}\`\n  return String(minutes)\n}\n\nconst amanDelayClass = (minutes: number | null) => {\n  if (minutes == null || minutes === 0) return 'nothing'\n  if (minutes < 0) return 'expedite'\n  return 'delay'\n}\n\nconst amanMetricDelay = (minutes: number) => \`\${minutes > 0 ? '+' : ''}\${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min\`\n\nconst compactStaffPosition = (value: string) => {`,
)

replace(
  'src/App.tsx',
  `<div className="app-shell">`,
  `<div className="app-shell aman-v2-shell">`,
)

replace(
  'src/App.tsx',
  `<h1>Bangkok FIR Arrival Sequencing</h1>`,
  `<h1>AMAN – Arrival Manager</h1>`,
)

replace(
  'src/App.tsx',
  `  return (\n    <div className="app-shell aman-v2-shell">`,
  `  const amanRows = sortArrivalRows(arrivals.filter((row) => !['LANDED', 'CANCELLED'].includes(row.status)))\n  const amanDelays = amanRows.map((row) => amanDelayMinutes(row.cldt, row.eldt)).filter((value): value is number => value != null)\n  const amanAverageDelay = amanDelays.length ? amanDelays.reduce((sum, value) => sum + value, 0) / amanDelays.length : 0\n  const amanMaxDelay = amanDelays.length ? Math.max(0, ...amanDelays) : 0\n  const amanEarliest = amanRows.length ? [...amanRows].sort((a, b) => new Date(a.cldt).getTime() - new Date(b.cldt).getTime())[0] : null\n  const amanLatest = amanRows.length ? [...amanRows].sort((a, b) => new Date(b.cldt).getTime() - new Date(a.cldt).getTime())[0] : null\n\n  return (\n    <div className="app-shell aman-v2-shell">`,
)

replaceRegex(
  'src/App.tsx',
  /        <section className="summary-grid">[\s\S]*?        <\/section>\n\n        \{workspace && \(/,
  `        <section className="aman-status-strip">\n          <article className="aman-stat-card"><span>In sequence</span><strong>{amanRows.length}</strong><small>active arrivals</small></article>\n          <article className="aman-stat-card delay"><span>Average delay</span><strong>{amanMetricDelay(amanAverageDelay)}</strong><small>TLDT − ELDT</small></article>\n          <article className="aman-stat-card max-delay"><span>Max delay</span><strong>{amanMetricDelay(amanMaxDelay)}</strong><small>required time to absorb</small></article>\n          <article className="aman-stat-card"><span>Earliest TLDT</span><strong>{amanEarliest ? timeOnly(amanEarliest.cldt) : '—'}</strong><small>{amanEarliest?.callsign ?? 'No active traffic'}</small></article>\n          <article className="aman-stat-card"><span>Latest TLDT</span><strong>{amanLatest ? timeOnly(amanLatest.cldt) : '—'}</strong><small>{amanLatest?.callsign ?? 'No active traffic'}</small></article>\n          <article className="aman-stat-card"><span>Controllers</span><strong>{onlineControllers.length || 1}</strong><small>realtime workspace</small></article>\n        </section>\n\n        {workspace && (`,
  'summary grid',
)

const trafficPanelPattern = /              \{workspace && <IvaoTrafficPanel[\s\S]*?              \/>\}\n/
replaceRegex('src/App.tsx', trafficPanelPattern, '', 'legacy IVAO panel')

const dashboard = `        {workspace && (\n          <>\n            <section className="aman-main-grid">\n              <article className="aman-sequence-panel">\n                <div className="aman-panel-head">\n                  <div>\n                    <span>AMAN TIMELINE · UTC</span>\n                    <h2>{workspace.airport} — Arrival Sequence</h2>\n                  </div>\n                  <div className="aman-panel-actions">\n                    <button className="primary-button" onClick={() => void addFlight()} disabled={!session || !workspace.timingReady || fixes.length === 0}>+ Add Flight</button>\n                  </div>\n                </div>\n                <div className="aman-sequence-table-wrap">\n                  <table className="aman-sequence-table">\n                    <thead><tr><th>TLDT<small>Target Landing Time</small></th><th>CALLSIGN</th><th>TYPE</th><th>IAWP / STAR<small>Entry fix / filed procedure</small></th><th>TTO<small>Target Time Over</small></th><th>DELAY<small>Required</small></th><th>RWY CFG</th></tr></thead>\n                    <tbody>\n                      {loading ? <tr><td colSpan={7} className="aman-panel-empty">Connecting to shared sequence…</td></tr> : amanRows.length === 0 ? <tr><td colSpan={7} className="aman-panel-empty">No active arrivals in sequence.</td></tr> : amanRows.map((row) => {\n                        const delay = amanDelayMinutes(row.cldt, row.eldt)\n                        const stars = workspaceConfig.starProcedures\n                          .filter((star) => star.runway_config_id === workspace.runwayId && star.active && star.entry_fix?.toUpperCase() === row.ref_fix.toUpperCase())\n                          .map((star) => star.designator)\n                        return (\n                          <tr key={row.id}>\n                            <td className="aman-tldt">{timeOnly(row.cldt)}</td>\n                            <td className="aman-callsign"><div className="aman-callsign-line">{airlineIcaoFromCallsign(row.callsign) && <span className="sequence-airline-logo" aria-hidden="true"><img src={\`/api/sequence/airline-logo?icao=\${encodeURIComponent(airlineIcaoFromCallsign(row.callsign) || '')}\`} alt="" onError={(event) => { event.currentTarget.closest('.sequence-airline-logo')?.classList.add('is-missing') }} /></span>}<span>{row.callsign}</span></div></td>\n                            <td>{row.aircraft_type || '—'}</td>\n                            <td className="aman-iawp"><strong>{row.ref_fix}</strong>{stars.length > 0 && <small>{stars.slice(0, 2).join(' / ')}</small>}</td>\n                            <td className="aman-tto">{timeOnly(row.cto)}</td>\n                            <td><span className={\`aman-delay-pill \${amanDelayClass(delay)}\`}>{amanDelayLabel(delay)}</span></td>\n                            <td className="aman-runway-config">{workspace.runway}</td>\n                          </tr>\n                        )\n                      })}\n                    </tbody>\n                  </table>\n                </div>\n              </article>\n\n              <aside>\n                <AmanTrafficSummary\n                  airport={workspace.airport}\n                  existingCallsigns={arrivals.map((row) => row.callsign)}\n                  importControl={<IvaoTrafficPanel\n                    airport={workspace.airport}\n                    fixes={fixes.map((fix) => fix.fix)}\n                    starProcedures={workspaceConfig.starProcedures\n                      .filter((star) => star.runway_config_id === workspace.runwayId && star.active)\n                      .filter((star) => !session || (!star.effective_from || star.effective_from <= session.service_date) && (!star.effective_to || star.effective_to >= session.service_date))\n                      .flatMap((star) => star.entry_fix ? [{ designator: star.designator, entryFix: star.entry_fix }] : [])}\n                    existingCallsigns={arrivals.map((row) => row.callsign)}\n                    disabled={!session || !workspace.timingReady || fixes.length === 0}\n                    onAdd={addIvaoFlight}\n                    onAddAll={addIvaoFlights}\n                  />}\n                />\n              </aside>\n            </section>\n\n            <section className="aman-delay-legend">\n              <strong>DELAY COLOUR CODING</strong>\n              <span className="aman-delay-key expedite"><i /> Expedite</span>\n              <span className="aman-delay-key nothing"><i /> Nothing</span>\n              <span className="aman-delay-key speed"><i /> Speed reduction</span>\n              <span className="aman-delay-key stretch"><i /> Path stretching</span>\n              <span className="aman-delay-key holding"><i /> Holding</span>\n              <span className="aman-delay-legend-note">Action thresholds are not configured yet; positive delay is displayed as required time only.</span>\n            </section>\n          </>\n        )}\n\n        <details className="aman-edit-board">\n          <summary>Detailed editable sequence board</summary>\n          <section className="workspace-card">`

replace(
  'src/App.tsx',
  `        <section className="workspace-card">`,
  dashboard,
)

replace(
  'src/App.tsx',
  `          </footer>\n        </section>\n      </main>`,
  `          </footer>\n          </section>\n        </details>\n      </main>`,
)

// Add lightweight summary mode to the IVAO endpoint. This avoids route geometry and domestic enrichment for the always-visible board.
replace(
  'functions/api/sequence/ivao-traffic.js',
  `function airlineIcaoFromCallsign(value) {\n  const callsign = String(value || '').trim().toUpperCase();\n  const match = callsign.match(/^([A-Z]{3})[A-Z0-9]/);\n  return match?.[1] || null;\n}`,
  `function airlineIcaoFromCallsign(value) {\n  const callsign = String(value || '').trim().toUpperCase();\n  const match = callsign.match(/^([A-Z]{3})[A-Z0-9]/);\n  return match?.[1] || null;\n}\n\nfunction flightPlanEobt(fp) {\n  const candidates = [fp?.estimatedDepartureTime, fp?.eobt, fp?.offBlockTime, fp?.departureTime];\n  for (const value of candidates) {\n    if (value == null || value === '') continue;\n    return String(value);\n  }\n  return null;\n}`,
)

replace(
  'functions/api/sequence/ivao-traffic.js',
  `    const airport = cleanAirport(url.searchParams.get('airport'));\n    if (!airport) return json({ error: 'Valid airport ICAO is required' }, 400);`,
  `    const airport = cleanAirport(url.searchParams.get('airport'));\n    if (!airport) return json({ error: 'Valid airport ICAO is required' }, 400);\n    const mode = String(url.searchParams.get('mode') || '').trim().toLowerCase();`,
)

replace(
  'functions/api/sequence/ivao-traffic.js',
  `    const inboundPilots = pilots\n      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport)\n      .filter((pilot) => !terminalStates.has(String(pilot?.lastTrack?.state || '').trim().toLowerCase()));\n\n    const flights = await Promise.all(inboundPilots.map(async (pilot) => {`,
  `    const inboundPilots = pilots\n      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport)\n      .filter((pilot) => !terminalStates.has(String(pilot?.lastTrack?.state || '').trim().toLowerCase()));\n\n    const departurePilots = pilots\n      .filter((pilot) => String(pilot?.flightPlan?.departureId || '').trim().toUpperCase() === airport)\n      .filter((pilot) => pilot?.lastTrack?.onGround !== false);\n\n    if (mode === 'summary') {\n      const inbound = inboundPilots.map((pilot) => {\n        const fp = pilot.flightPlan || {};\n        const track = pilot.lastTrack || {};\n        return {\n          sessionId: String(pilot.id ?? ''),\n          callsign: String(pilot.callsign || '').trim().toUpperCase(),\n          aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,\n          departure: fp.departureId ? String(fp.departureId).trim().toUpperCase() : null,\n          arrival: airport,\n          route: fp.route ? String(fp.route).trim().toUpperCase() : null,\n          state: track.state ? String(track.state).trim() : null,\n        };\n      }).filter((flight) => flight.callsign).sort((a, b) => a.callsign.localeCompare(b.callsign));\n\n      const departures = departurePilots.map((pilot) => {\n        const fp = pilot.flightPlan || {};\n        const track = pilot.lastTrack || {};\n        return {\n          sessionId: String(pilot.id ?? ''),\n          callsign: String(pilot.callsign || '').trim().toUpperCase(),\n          aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,\n          arrival: fp.arrivalId ? String(fp.arrivalId).trim().toUpperCase() : null,\n          route: fp.route ? String(fp.route).trim().toUpperCase() : null,\n          state: track.state ? String(track.state).trim() : null,\n          eobt: flightPlanEobt(fp),\n        };\n      }).filter((flight) => flight.callsign).sort((a, b) => String(a.eobt || '9999').localeCompare(String(b.eobt || '9999')) || a.callsign.localeCompare(b.callsign));\n\n      return json({ airport, fetchedAt: new Date().toISOString(), inbound, departures });\n    }\n\n    const flights = await Promise.all(inboundPilots.map(async (pilot) => {`,
)

// Remove temporary patch machinery from the resulting production commit.
for (const path of ['scripts/patch-aman-v2.cjs', '.github/workflows/patch-aman-v2.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path)
}
