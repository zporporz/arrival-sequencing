import { useEffect, useMemo, useState } from 'react'
import type { AircraftPerformanceProfile } from './core/api'
import { calculateRegionalTiming, type RegionalCode, type RegionalNavPayload, type RegionalTiming } from './core/regionalArrivalModel'
import { estimateRegionalEntry, estimateRegionalLive } from './core/regionalLiveEstimate'
import { regionalFlightArrival } from './core/regionalAmanAdapter'
import { rememberArrivalStar } from './core/arrivalStarChoice'
import ArrivalStarControl from './ArrivalStarControl'
import { formatRoundedHmUtc } from './core/minuteRounding'
import { previewPerformance, readRegionalNav, readRegionalSnapshot, type RegionalSnapshot } from './core/regionalPreviewData'
import './regionalAman.css'

const defaults: Record<RegionalCode, Record<string, string>> = { VTCC: { '18': 'R18', '36': 'I36-Z' }, VTSP: { '09': 'R09-Y', '27': 'I27' } }
const utc = formatRoundedHmUtc
const duration = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`

function TimingDetails({ timing }: { timing: RegionalTiming }) {
  return <div className="regional-details">
    <p>{timing.star} → {timing.approach} · {timing.distanceNm.toFixed(1)} NM · STAR {duration(timing.starSeconds)} + approach {duration(timing.approachSeconds)}</p>
    <div className="regional-table-scroll"><table><caption>Nominal no-wind profile · times in min:sec</caption><thead><tr>
      <th>Leg</th><th>NM</th><th>Altitude ft</th><th>IAS kt</th><th>Time</th>
    </tr></thead><tbody>{timing.segments.map((s, i) => <tr key={i}>
      <td>{s.from.fix} → {s.to.fix}</td><td>{s.distanceNm.toFixed(1)}</td>
      <td>{Math.round(s.startAltitudeFt)} → {Math.round(s.endAltitudeFt)}</td><td>{Math.round(s.startIasKt)} → {Math.round(s.endIasKt)}</td><td>{duration(s.seconds)}</td>
    </tr>)}</tbody></table></div>
    <p className="regional-muted">{timing.warnings.join(' · ')}</p>
  </div>
}

export default function RegionalAman() {
  const initial = new URLSearchParams(window.location.search).get('regional') === 'VTSP' ? 'VTSP' : 'VTCC'
  const [airport, setAirport] = useState<RegionalCode>(initial)
  const [runway, setRunway] = useState(initial === 'VTSP' ? '27' : '18')
  const [approachName, setApproachName] = useState(defaults[initial][runway])
  const [nav, setNav] = useState<RegionalNavPayload | null>(null)
  const [navError, setNavError] = useState('')
  const [snapshot, setSnapshot] = useState<RegionalSnapshot | null>(null)
  const [trafficError, setTrafficError] = useState('')
  const [reload, setReload] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [calculatorStar, setCalculatorStar] = useState('')
  const [typeInput, setTypeInput] = useState('A320')
  const [calculatorType, setCalculatorType] = useState('A320')
  const [calculatorProfile, setCalculatorProfile] = useState<AircraftPerformanceProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [, refreshChoice] = useState(0)

  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let cancelled = false
    setNav(null); setNavError(''); setSnapshot(null)
    readRegionalNav(airport).then((data) => { if (!cancelled) setNav(data) })
      .catch((error) => { if (!cancelled) setNavError(String(error.message || error)) })
    return () => { cancelled = true }
  }, [airport, reload])
  useEffect(() => {
    if (!nav) return
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    setSnapshot(null); setTrafficError('')
    const refresh = async () => {
      try {
        const value = await readRegionalSnapshot(nav, runway)
        if (!cancelled) { setSnapshot(value); setTrafficError('') }
      } catch (error) {
        if (!cancelled) { setSnapshot(null); setTrafficError(error instanceof Error ? error.message : String(error)) }
      } finally { if (!cancelled) timer = setTimeout(refresh, 15_000) }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [nav, runway])
  // Verify AIRAC again during a long-lived session, not just on opening the page.
  useEffect(() => {
    const timer = setInterval(() => setReload((n) => n + 1), 300_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    let cancelled = false
    setCalculatorProfile(null); setProfileError('')
    previewPerformance(calculatorType).then((value) => {
      if (!cancelled) { setCalculatorProfile(value); if (!value) setProfileError('SimBrief profile not available for this type') }
    }).catch(() => { if (!cancelled) setProfileError('Unable to load SimBrief profile') })
    return () => { cancelled = true }
  }, [calculatorType, reload])

  const stars = useMemo(() => nav?.airport.procedures.filter((p) => p.kind === 'STAR' && p.runway === runway) || [], [nav, runway])
  const approaches = nav?.airport.procedures.filter((p) => p.kind === 'APPROACH' && p.runway === runway) || []
  const approach = approaches.find((p) => p.name === approachName)
  const selectedStar = stars.find((p) => p.id === calculatorStar) || stars[0]
  const calculation = nav && selectedStar && approach && calculatorProfile ? calculateRegionalTiming(nav.airport, selectedStar, approach, calculatorProfile) : null
  const stale = !snapshot || clock - Date.parse(snapshot.traffic.fetchedAt) > 90_000
  const rows = (snapshot?.traffic.flights || []).map((flight) => {
    const arrival = nav && regionalFlightArrival(nav, runway, flight), star = arrival?.star
    const profile = snapshot!.profiles[flight.aircraft || '']
    const result = nav && star && approach ? calculateRegionalTiming(nav.airport, star, approach, profile) : null
    const live = result?.timing && profile && !stale ? estimateRegionalLive(flight, result.timing, profile, snapshot!.routes[flight.sessionId] || null, snapshot!.traffic.fetchedAt) : null
    const entryOnly = !stale && !live?.estimate && arrival?.entryFix
      ? estimateRegionalEntry(flight, snapshot!.routes[flight.sessionId] || null, arrival.entryFix, snapshot!.traffic.fetchedAt) : null
    return { flight, star, selection: arrival?.selection, entryOnly, timing: result?.timing, estimate: live?.estimate,
      reason: stale ? 'STALE — refreshing traffic' : !star ? 'STAR unresolved for this runway — check filed route' : !approach ? 'Select approach'
        : result?.error || (live?.error && snapshot?.routeErrors?.[flight.sessionId] ? `Route service: ${snapshot.routeErrors[flight.sessionId]}` : live?.error) || '' }
  }).sort((a, b) => (a.estimate?.tldtMs ?? Infinity) - (b.estimate?.tldtMs ?? Infinity) || a.flight.callsign.localeCompare(b.flight.callsign))

  return <main className="regional-aman">
    <header className="regional-header"><div><span className="regional-eyebrow">THAILAND AMAN · EXPERIMENTAL</span><h1>Regional arrivals</h1></div><a href="/">Back to VTBD / VTBS</a></header>
    <p className="regional-notice">โหมดทดลอง · เวลา EST เท่านั้น · ยังไม่จัด separation หรือล็อก stage และไม่เขียนทับคิวควบคุมร่วม</p>
    <section className="regional-controls" aria-label="Regional airport configuration">
      <label>Airport<select value={airport} onChange={(e) => {
        const code = e.target.value as RegionalCode, rwy = code === 'VTCC' ? '18' : '27'
        setAirport(code); setRunway(rwy); setApproachName(defaults[code][rwy]); setCalculatorStar(''); setSnapshot(null); setNav(null)
      }}><option>VTCC</option><option>VTSP</option></select></label>
      <label>Runway<select value={runway} onChange={(e) => { setRunway(e.target.value); setApproachName(defaults[airport][e.target.value]); setCalculatorStar(''); setSnapshot(null) }}>
        {Object.keys(defaults[airport]).map((r) => <option key={r}>{r}</option>)}</select></label>
      <label>Assumed approach<select value={approachName} onChange={(e) => setApproachName(e.target.value)}>{approaches.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
      <div className="regional-meta">AIRAC {nav?.cycle || '—'}<br />{new Date(clock).toISOString().slice(11, 19)}Z</div>
      <button onClick={() => setReload((n) => n + 1)}>Refresh</button>
    </section>
    {navError && <p role="alert" className="regional-error">{navError}</p>}
    {!nav && !navError && <p role="status">Verifying active AIRAC…</p>}
    {nav && <>
      <section className="regional-panel"><div className="regional-section-title"><h2>Live arrivals · {airport}</h2><span>{snapshot ? `IVAO snapshot ${new Date(snapshot.traffic.fetchedAt).toISOString().slice(11, 19)}Z` : 'Loading…'}</span></div>
        {trafficError && <p role="alert" className="regional-error">{trafficError}</p>}
        <div className="regional-table-scroll"><table><caption>Ordered by estimated landing time · approach selection is an assumption, not an ATC clearance</caption>
          <thead><tr><th>Aircraft</th><th>STAR</th><th>ETA-FF</th><th>STA-FF*</th><th>TLDT EST</th><th>Model / status</th></tr></thead>
          <tbody>{rows.map(({ flight, star, selection, entryOnly, timing, estimate, reason }) => <tr key={flight.sessionId}>
            <td><strong>{flight.callsign}</strong><small>{flight.aircraft} · {flight.state}</small></td><td>{star?.name || '—'}
              <ArrivalStarControl callsign={flight.callsign} selection={selection} onChange={name => {
                if (selection) rememberArrivalStar(flight, selection, name)
                refreshChoice(n => n + 1)
              }} />
            </td>
            <td>{estimate?.pastEntry ? 'PASSED*' : utc(estimate?.etaFfMs ?? entryOnly ?? null)}{entryOnly != null && <small>ENTRY ONLY EST</small>}</td><td>{utc(estimate?.etaFfMs ?? null)}</td><td className="regional-time">{utc(estimate?.tldtMs ?? null)}</td>
            <td>{estimate ? <small>{estimate.remainingNm.toFixed(1)} NM remaining · {estimate.offRouteNm.toFixed(1)} NM off route</small> : <small className="regional-warning">{reason}</small>}
              {timing && <details><summary>STAR + approach {duration(timing.nominalSeconds)}</summary><TimingDetails timing={timing} /></details>}
            </td></tr>)}</tbody></table></div>
        {snapshot && !rows.length && <p className="regional-empty">No connected IFR arrivals for {airport}. Try the route calculator below.</p>}
        <p className="regional-muted">*STA-FF = ETA-FF ในโหมดที่ยังไม่จัดคิว · PASSED เป็นตำแหน่งบนเส้นทาง ไม่ใช่เวลาผ่านจริงที่บันทึกไว้ · TLDT ใช้เวลาถึง threshold เป็นค่าประมาณ ไม่รวม flare</p>
      </section>
      <section className="regional-panel"><h2>Route calculator</h2><form className="regional-controls" onSubmit={(e) => { e.preventDefault(); setCalculatorType(typeInput.trim().toUpperCase()); setReload((n) => n + 1) }}>
        <label>STAR<select value={selectedStar?.id || ''} onChange={(e) => setCalculatorStar(e.target.value)}>{stars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Aircraft type<input value={typeInput} maxLength={4} onChange={(e) => setTypeInput(e.target.value.toUpperCase())} placeholder="A320" /></label><button type="submit">Calculate</button>
        <span className="regional-meta">{calculatorProfile ? `SimBrief ${calculatorProfile.aircraftType} · ${calculatorProfile.descentProfile} · CAT ${calculatorProfile.performanceCategory || '—'}` : profileError || 'Loading profile…'}</span>
      </form>{calculation?.error && <p className="regional-warning">{calculation.error}</p>}{calculation?.timing && <><p className="regional-total">{duration(calculation.timing.nominalSeconds)} <small>STAR entry → runway threshold · EST</small></p><TimingDetails timing={calculation.timing} /></>}</section>
    </>}
    <footer>For flight simulation only · speed/altitude restrictions + SimBrief speed schedule; not a validated aircraft performance prediction.</footer>
  </main>
}
