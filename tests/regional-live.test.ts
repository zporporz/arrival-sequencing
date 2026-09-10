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
    expect(estimateRegionalLive({ ...flight(), latitude: 40 }, timing, profile, null, now).error).toMatch(/Off published/)
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
  })
  it('does not label a position just before entry as PASSED when its upstream route is missing', () => {
    const s = timing.segments[0]
    const f = { ...flight(), latitude: s.from.lat! - .05 * (s.to.lat! - s.from.lat!), longitude: s.from.lon! - .05 * (s.to.lon! - s.from.lon!) }
    expect(estimateRegionalLive(f, timing, profile, null, now).estimate).toBeUndefined()
  })
})
