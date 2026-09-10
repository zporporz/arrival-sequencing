import { describe, expect, it } from 'vitest'
import { estimateRegionalLive } from '../src/core/regionalLiveEstimate'
import { calculateRegionalTiming, type RegionalAirport } from '../src/core/regionalArrivalModel'
import bundle from '../functions/_data/regional-arrivals.json'
import type { AircraftPerformanceProfile, IvaoArrivalTrafficFlight } from '../src/core/api'
import type { RouteGeometry } from '../src/core/arrivalEtaLegacy'
const airport = bundle.airports.VTSP as unknown as RegionalAirport
const star = airport.procedures.find((p) => p.kind === 'STAR' && p.runway === '27')!
const approach = airport.procedures.find((p) => p.name === 'I27')!
const profile = { source: 'SIMBRIEF', aircraftType: 'A320', performanceCategory: 'C', descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 } as AircraftPerformanceProfile
const timing = calculateRegionalTiming(airport, star, approach, profile).timing!
const now = '2026-09-10T10:00:00Z'
function flight(): IvaoArrivalTrafficFlight {
  const s = timing.segments[0]
  const dx = (s.to.lon! - s.from.lon!) * Math.cos(s.from.lat! * Math.PI / 180), dy = s.to.lat! - s.from.lat!
  return { sessionId: 'regional-test', callsign: 'TEST123', arrival: 'VTSP', departure: 'VTBD', route: star.name,
    state: 'en route', onGround: false, groundSpeed: 250, altitude: (s.startAltitudeFt + s.endAltitudeFt) / 2,
    heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
    latitude: (s.from.lat! + s.to.lat!) / 2, longitude: (s.from.lon! + s.to.lon!) / 2,
    trackTimestamp: now, connectedAirborne: true, filedDepartureTimeSeconds: 14 * 3600, filedEetSeconds: 3 * 3600,
  } as IvaoArrivalTrafficFlight
}
describe('regional airborne timing', () => {
  it('uses remaining path after an airborne connect, never departure/EET or backward FF time', () => {
    const result = estimateRegionalLive(flight(), timing, profile, null, now).estimate!
    expect(result).toBeTruthy()
    expect(result.pastEntry).toBe(true)
    expect(result.etaFfMs).toBeNull()
    expect(result.remainingNm).toBeLessThan(timing.distanceNm)
    expect(result.tldtMs).toBeGreaterThan(Date.parse(now))
    expect(result.tldtMs).toBeLessThan(Date.parse(now) + timing.nominalSeconds * 1000)
    expect(estimateRegionalLive({ ...flight(), filedEetSeconds: 100, filedDepartureTimeSeconds: 0 }, timing, profile, null, now)).toEqual({ estimate: result })
  })
  it('is anchored to the track timestamp instead of drifting with wall time', () => {
    expect(estimateRegionalLive(flight(), timing, profile, null, now).estimate?.tldtMs)
      .toBe(estimateRegionalLive(flight(), timing, profile, null, '2026-09-10T10:00:30Z').estimate?.tldtMs)
  })
  it('rejects stale, ground, terminal, off-route and wrong-direction samples', () => {
    expect(estimateRegionalLive(flight(), timing, profile, null, '2026-09-10T10:02:00Z').error).toMatch(/STALE/)
    expect(estimateRegionalLive({ ...flight(), onGround: true }, timing, profile, null, now).error).toMatch(/GROUND/)
    expect(estimateRegionalLive({ ...flight(), state: 'Landed' }, timing, profile, null, now).error).toMatch(/Terminal/)
    expect(estimateRegionalLive({ ...flight(), latitude: 40 }, timing, profile, null, now).error).toMatch(/Route to STAR entry unavailable/)
    expect(estimateRegionalLive({ ...flight(), heading: (flight().heading! + 180) % 360 }, timing, profile, null, now).estimate).toBeUndefined()
    expect(estimateRegionalLive({ ...flight(), latitude: null }, timing, profile, null, now).error).toMatch(/Position/)
  })
  it('requires a connected upstream route before generating ETA-FF', () => {
    const entry = { lat: timing.entry.lat!, lon: timing.entry.lon! }
    const start = { lat: entry.lat + 1, lon: entry.lon }
    const f = { ...flight(), latitude: entry.lat + .5, longitude: entry.lon, heading: 180, altitude: 20000, groundSpeed: 400 }
    const geo: RouteGeometry = { origin: 'VTBD', destination: 'VTSP', totalDistance: 60, errors: [], segments: [{
      from: { identifier: 'START', type: 'FIX', coordinates: start }, to: { identifier: timing.entry.fix!, type: 'FIX', coordinates: entry },
      distance: 60, bearing: 180, cumulativeDistance: 60,
    }] }
    const result = estimateRegionalLive(f, timing, profile, geo, now).estimate!
    expect(result).toBeTruthy()
    expect(result.pastEntry).toBe(false)
    expect(result.tldtMs - result.etaFfMs!).toBeCloseTo(timing.nominalSeconds * 1000, 0)
    expect(estimateRegionalLive(f, timing, profile, null, now).estimate).toBeUndefined()
    expect(estimateRegionalLive(f, timing, profile, { ...geo, errors: [{ type: 'route', message: 'missing airway' }] }, now).estimate).toBeUndefined()
    expect(estimateRegionalLive(f, timing, profile, { ...geo, destination: 'VTCC' }, now).estimate).toBeUndefined()
    const disconnected = { ...geo, segments: [
      { ...geo.segments[0], to: { identifier: 'GAP', type: 'FIX', coordinates: { lat: entry.lat + .1, lon: entry.lon } } },
      { ...geo.segments[0], from: geo.segments[0].to },
    ] }
    expect(estimateRegionalLive(f, timing, profile, disconnected, now).estimate).toBeUndefined()
    const partial = { ...geo, entryFix: timing.entry.fix!, cycle: '2609' }
    const withSidWarning: RouteGeometry = { ...geo, cycle: '2609', errors: [{ type: 'procedure_no_segments', message: 'SID needs runway' }], entryRoute: partial }
    expect(estimateRegionalLive(f, timing, profile, withSidWarning, now).estimate).toEqual(result)
    expect(estimateRegionalLive(f, timing, profile, { ...withSidWarning, entryRoute: { ...partial, cycle: '2608' } }, now).estimate).toBeUndefined()
    expect(estimateRegionalLive(f, timing, profile, { ...withSidWarning, entryRoute: { ...partial, entryFix: 'WRONG' } }, now).estimate).toBeUndefined()
    expect(estimateRegionalLive(f, timing, profile, { ...withSidWarning, entryRoute: { ...partial, errors: [{ type: 'airway_not_found', message: 'missing airway' }] } }, now).estimate).toBeUndefined()
    expect(estimateRegionalLive({ ...f, latitude: start.lat + .1 }, timing, profile, withSidWarning, now).estimate).toBeUndefined()
    expect(estimateRegionalLive({ ...f, longitude: f.longitude + 1 }, timing, profile, withSidWarning, now).error).toMatch(/Off published/)
  })
  it('does not label a position just before entry as PASSED when its upstream route is missing', () => {
    const s = timing.segments[0]
    const f = { ...flight(), latitude: s.from.lat! - .05 * (s.to.lat! - s.from.lat!), longitude: s.from.lon! - .05 * (s.to.lon! - s.from.lon!) }
    expect(estimateRegionalLive(f, timing, profile, null, now).estimate).toBeUndefined()
  })
  it('regression: NOK0409 on Y26 gets ETA-FF and TLDT before MARNI instead of a vector warning', () => {
    const vtcc = bundle.airports.VTCC as unknown as RegionalAirport
    const star = vtcc.procedures.find((p) => p.name === 'MARN2A')!
    const approach = vtcc.procedures.find((p) => p.name === 'I36-Z')!
    const b738 = { ...profile, aircraftType: 'B738', performanceCategory: 'D' }
    const model = calculateRegionalTiming(vtcc, star, approach, b738).timing!
    // Read-only IVAO/AIRAC diagnostic sample captured at 06:26:32Z, 10 Sep 2026.
    const sample = '2026-09-10T06:26:32Z'
    const points = [
      { identifier: 'OLVUK', type: 'waypoint', coordinates: { lat: 14.657883, lon: 100.211175 } },
      { identifier: 'UPMUT', type: 'waypoint', coordinates: { lat: 15.011944, lon: 100.093333 } },
      { identifier: 'ELDAL', type: 'waypoint', coordinates: { lat: 16.351667, lon: 99.644167 } },
      { identifier: 'NUVLU', type: 'waypoint', coordinates: { lat: 16.696111, lon: 99.527778 } },
      { identifier: 'BEBUV', type: 'waypoint', coordinates: { lat: 17.453611, lon: 99.270278 } },
      { identifier: 'MARNI', type: 'waypoint', coordinates: { lat: 18.143372, lon: 99.096975 } },
    ]
    const geo: RouteGeometry = { origin: 'VTBD', destination: 'VTCC', cycle: '2609', totalDistance: null, errors: [],
      segments: points.slice(1).map((p, i) => ({ from: points[i], to: p, distance: 1, cumulativeDistance: i + 1, bearing: null })) }
    const f = { ...flight(), arrival: 'VTCC', callsign: 'NOK0409', route: 'OLVUK1B OLVUK Y26 MARNI MARNI2A',
      latitude: 16.027168, longitude: 99.75291, altitude: 34229, groundSpeed: 434, heading: 343, trackTimestamp: sample }
    const result = estimateRegionalLive(f, model, b738, geo, sample)
    expect(result.error).toBeUndefined()
    expect(result.estimate!.pastEntry).toBe(false)
    expect(result.estimate!.offRouteNm).toBeLessThan(.1)
    expect(result.estimate!.etaFfMs).toBeGreaterThan(Date.parse(sample))
    expect(result.estimate!.tldtMs - result.estimate!.etaFfMs!).toBeCloseTo(model.nominalSeconds * 1000, 0)
  })
})
