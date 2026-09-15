import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearArrivalRouteCache, resolveArrivalRoute } from '../src/core/arrivalRouteGeometry'
import { findAipIawp } from '../src/aipArrivalIawp'
import transitions from '../shared/arrivalEntryTransitions.json'
import { estimateIawpArrival, resetArrivalEtaStageState, type RouteGeometry } from '../src/core/arrivalEta'
import type { IvaoArrivalTrafficFlight } from '../src/core/api'

const geometry: RouteGeometry = { origin: 'VTST', destination: 'VTBD', errors: [], totalDistance: 100, cycle: '2609', segments: [{
  from: { identifier: 'HOTEL', type: 'FIX', coordinates: { lat: 13, lon: 100 } },
  to: { identifier: 'SABAI', type: 'FIX', coordinates: { lat: 14, lon: 100 } },
  distance: 100, bearing: 0, cumulativeDistance: 100,
}] }
const flight = { departure: 'VTST', route: 'TRN Y99 HOTEL' }
beforeEach(() => { clearArrivalRouteCache(); vi.useFakeTimers(); vi.setSystemTime('2026-09-15T13:00:00Z') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('arrival route client', () => {
  it('sends the selected runway and separates runway cache entries', async () => {
    const fetch = vi.fn(async () => Response.json(geometry)); vi.stubGlobal('fetch', fetch)
    await Promise.all([resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R'), resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ arrivalRunway: '21R', entryFix: 'SABAI' })
    await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21L')
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(61_000)
    await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')
    expect(fetch).toHaveBeenCalledTimes(3) // AIRAC is rechecked, not cached forever
  })
  it('retries failures and returns the diagnostic rather than silently losing geometry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Runway unavailable' }, { status: 502 }))
      .mockResolvedValueOnce(Response.json(geometry)); vi.stubGlobal('fetch', fetch)
    const failed = await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')
    expect(failed.geometry).toBeNull(); expect(failed.reason).toContain('Runway unavailable')
    clearArrivalRouteCache('VTBD')
    expect((await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')).geometry).not.toBeNull()
  })
  it('labels inferred feeder geometry rather than calling it a cleared STAR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...geometry, entryRouteSource: 'AIP_INFERRED',
      entryTransition: { via: 'HOTEL', path: ['SABAI'], source: transitions.source } })))
    const result = await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')
    expect(result.inferred).toBe(true)
    expect(result.reason).toContain('HOTEL → SABAI')
    expect(result.reason).toContain('NOT A CLEARED STAR')
  })
  it('rejects mismatched partial-cycle data, warnings and a route missing its entry', async () => {
    for (const bad of [
      { ...geometry, errors: [{ message: 'SID unavailable' }], entryRoute: { ...geometry, cycle: '2608', entryFix: 'SABAI' } },
      { ...geometry, errors: [{ message: 'Unresolved airway' }] },
      { ...geometry, segments: [] },
    ]) {
      clearArrivalRouteCache()
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(bad)))
      expect((await resolveArrivalRoute(flight, 'VTBD', 'SABAI', '21R')).geometry).toBeNull()
    }
  })
})

describe('shared feeder mapping covers both Bangkok airports', () => {
  for (const [airport, entries] of Object.entries(transitions.airports)) {
    const allowed = [...new Set(Object.values(entries).map(path => path.at(-1)!))]
    it.each(Object.entries(entries))(`${airport} resolves %s`, (via, path) => {
      expect(findAipIawp(airport, `DCT ${via}`, allowed)?.entryFix).toBe(path.at(-1))
    })
  }
})

describe('cruise route recovery', () => {
  it('replaces the reported EET fallback with position ETA and recomputes on later cruise samples', async () => {
    window.localStorage.clear(); resetArrivalEtaStageState()
    const sample = { ...flight, sessionId: 'route-recovery', callsign: 'TLM128', arrival: 'VTBD',
      onGround: false, state: 'en route', altitude: 30933, filedCruiseAltitudeFt: 31000,
      latitude: 10.5, longitude: 100, groundSpeed: 468, verticalSpeedFpm: 0,
      connectedAt: '2026-09-15T11:37:14Z', trackTimestamp: '2026-09-15T13:00:00Z',
      actualDepartureTimeSeconds: 45620, filedEetSeconds: 4320, connectedAirborne: false,
    } as IvaoArrivalTrafficFlight
    const g = { ...geometry, totalDistance: 180, segments: [{ ...geometry.segments[0],
      from: { ...geometry.segments[0].from, coordinates: { lat: 10, lon: 100 } },
      to: { ...geometry.segments[0].to, coordinates: { lat: 13, lon: 100 } },
      distance: 180, cumulativeDistance: 180,
    }] }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(g)))
    const fallback = estimateIawpArrival(sample, null, 'SABAI', 1200, sample.trackTimestamp!)
    expect(fallback.source).toBe('ACTUAL_DEPARTURE_EET')
    expect(fallback.predictedIawpAt).toBe('2026-09-15T13:32:20.000Z')
    const resolved = await resolveArrivalRoute(sample, 'VTBD', 'SABAI', '21R')
    const live = estimateIawpArrival(sample, resolved.geometry, 'SABAI', 1200, sample.trackTimestamp!)
    expect(live.source).toBe('LIVE_ROUTE')
    expect(live.predictedIawpAt).not.toBe(fallback.predictedIawpAt)
    expect(live.reason).toContain('LIVE BOTH-DIRECTIONS')
    const moved = { ...sample, latitude: 10.8, trackTimestamp: '2026-09-15T13:00:15Z' }
    const next = estimateIawpArrival(moved, resolved.geometry, 'SABAI', 1200, moved.trackTimestamp)
    expect(next.source).toBe('LIVE_ROUTE')
    expect(next.remainingNm!).toBeLessThan(live.remainingNm!)
    expect(Date.parse(next.predictedIawpAt!)).toBeLessThan(Date.parse(live.predictedIawpAt!))
  })
})
