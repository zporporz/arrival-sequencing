import { afterEach, describe, expect, it } from 'vitest'
import { estimateIawpArrival, resetArrivalEtaStageState, type RouteGeometry } from '../src/core/arrivalEta'
import type { IvaoArrivalTrafficFlight } from '../src/core/api'
import { resolveFrozenTrigger } from '../src/etaFfLifecycleRuntime'
import { evaluateFinalTenNm } from '../src/finalTenNmRuntime'

const now = Date.parse('2026-08-25T10:00:00.000Z')

function flight(overrides: Partial<IvaoArrivalTrafficFlight> = {}): IvaoArrivalTrafficFlight {
  return {
    sessionId: 'eta-test-session',
    vid: '123456',
    callsign: 'THA123',
    aircraft: 'A320',
    wakeTurbulence: 'M',
    departure: 'VTBD',
    arrival: 'VTBS',
    route: null,
    flightRules: 'I',
    state: 'en route',
    onGround: false,
    trackTimestamp: new Date(now).toISOString(),
    altitude: 31_000,
    verticalSpeedFpm: 0,
    groundSpeed: 500,
    latitude: 0,
    longitude: 1,
    heading: 90,
    connectedAt: new Date(now - 60 * 60_000).toISOString(),
    airlineIcao: 'THA',
    flightPlanId: 'fp-1',
    flightPlanRevision: 1,
    filedCruiseAltitudeFt: 31_000,
    filedDepartureTimeSeconds: null,
    actualDepartureTimeSeconds: null,
    filedEetSeconds: null,
    departureCountryId: 'TH',
    arrivalCountryId: 'TH',
    isDomesticThailand: true,
    trackedTakeoffAt: null,
    filedDestinationEtaAt: null,
    domesticTriggerStatus: 'READY',
    domesticTriggerError: null,
    flightPlanDetailError: null,
    ...overrides,
  }
}

const geometry: RouteGeometry = {
  origin: 'VTBD',
  destination: 'VTBS',
  totalDistance: 120,
  errors: [],
  segments: [{
    from: { identifier: 'START', type: 'FIX', coordinates: { lat: 0, lon: 0 } },
    to: { identifier: 'NORTA', type: 'FIX', coordinates: { lat: 0, lon: 2 } },
    distance: 120,
    bearing: 90,
    cumulativeDistance: 120,
  }],
}

afterEach(() => {
  resetArrivalEtaStageState()
  window.localStorage.clear()
})

describe('FROZEN detection', () => {
  it('detects an aligned fresh aircraft inside 10 NM final', () => {
    const result = evaluateFinalTenNm('VTBS', '19', {
      callsign: 'THA123',
      latitude: 13.772,
      longitude: 100.781,
      heading: 194.42,
      onGround: false,
      trackTimestamp: new Date(now).toISOString(),
    }, now)

    expect(result.available).toBe(true)
    expect(result.final).toBe(true)
    expect(result.along).toBeGreaterThan(0)
    expect(result.along).toBeLessThanOrEqual(10)
  })

  it('uses the four-minute fallback only when geometry is unavailable', () => {
    expect(resolveFrozenTrigger({
      finalTenNm: false,
      finalGeometryAvailable: false,
      targetLandingMs: now + 4 * 60_000,
      nowMs: now,
    })).toBe('TLDT_4MIN_FALLBACK')
    expect(resolveFrozenTrigger({
      finalTenNm: false,
      finalGeometryAvailable: true,
      targetLandingMs: now + 3 * 60_000,
      nowMs: now,
    })).toBeNull()
    expect(resolveFrozenTrigger({
      finalTenNm: true,
      finalGeometryAvailable: true,
      targetLandingMs: now + 20 * 60_000,
      nowMs: now,
    })).toBe('10NM_FINAL')
  })
})

describe('dynamic ETA', () => {
  it('puts a late-joining controller directly into dynamic ETA during descent', () => {
    const descendingFlight = flight({
      sessionId: 'late-controller-descent',
      state: 'en route',
      altitude: 20_000,
      verticalSpeedFpm: -1_200,
      groundSpeed: 100,
      actualDepartureTimeSeconds: 7 * 60 * 60,
      filedEetSeconds: 3 * 60 * 60,
    })

    // The takeoff/EET baseline is 10:00Z, while the current low-speed route
    // projection is later. A fresh browser must accept the descent LIVE estimate
    // immediately instead of holding the earlier browser-local climb baseline.
    const estimate = estimateIawpArrival(
      descendingFlight,
      geometry,
      'NORTA',
      0,
      new Date(now).toISOString(),
    )

    expect(estimate.source).toBe('LIVE_ROUTE')
    expect(estimate.modelPhase).toBe('DESCENT')
    expect(new Date(estimate.predictedIawpAt!).getTime()).toBeGreaterThan(now)
    expect(estimate.reason).toContain('DESCENT OBSERVED')
    expect(estimate.reason).toContain('LIVE BOTH-DIRECTIONS')
  })

  it('allows ETA to move later after a hold/vector slowdown at cruise altitude', () => {
    const first = estimateIawpArrival(flight({ groundSpeed: 600 }), geometry, 'NORTA', 0, new Date(now).toISOString())
    const laterSampleTime = now + 60_000
    const slowed = estimateIawpArrival(flight({
      groundSpeed: 100,
      trackTimestamp: new Date(laterSampleTime).toISOString(),
    }), geometry, 'NORTA', 0, new Date(laterSampleTime).toISOString())

    expect(first.source).toBe('LIVE_ROUTE')
    expect(slowed.source).toBe('LIVE_ROUTE')
    expect(new Date(slowed.predictedIawpAt!).getTime()).toBeGreaterThan(new Date(first.predictedIawpAt!).getTime())
    expect(slowed.reason).toContain('LIVE BOTH-DIRECTIONS')
  })
})
