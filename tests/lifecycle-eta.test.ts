import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimateIawpArrival, resetArrivalEtaStageState, type RouteGeometry } from '../src/core/arrivalEta'
import type { IvaoArrivalTrafficFlight } from '../src/core/api'
import { installEtaFfLifecycleRuntime, resolveFrozenTrigger } from '../src/etaFfLifecycleRuntime'
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
    connectedAirborne: false,
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

const crossedGeometry: RouteGeometry = {
  origin: 'START',
  destination: 'END',
  totalDistance: 120,
  errors: [],
  segments: [
    {
      from: { identifier: 'START', type: 'FIX', coordinates: { lat: 0, lon: 0 } },
      to: { identifier: 'NORTA', type: 'FIX', coordinates: { lat: 0, lon: 1 } },
      distance: 60,
      bearing: 90,
      cumulativeDistance: 60,
    },
    {
      from: { identifier: 'NORTA', type: 'FIX', coordinates: { lat: 0, lon: 1 } },
      to: { identifier: 'END', type: 'FIX', coordinates: { lat: 0, lon: 2 } },
      distance: 60,
      bearing: 90,
      cumulativeDistance: 120,
    },
  ],
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

  it('requests one category target capture when live final geometry enters FROZEN', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    document.body.innerHTML = `
      <div class="aman-flight-row" data-final-geometry-available="true" data-final-ten-nm="true"
        data-final-along-nm="9.8" data-final-track-at="2026-08-25T10:00:00.000Z"
        data-performance-category="C"
        title="ETA-FF 09:45:00Z · STA/TLDT 10:10:00Z · STA-FF/TTO 09:45:00Z · VTBS RWY 19">
        <span></span><strong>THA123</strong><span></span><span></span><span>09:45</span>
        <em class="runway-assignment">19</em>
      </div>
    `
    const requests: unknown[] = []
    const onRequest = (event: Event) => requests.push((event as CustomEvent).detail)
    window.addEventListener('aman:frozen-target-request', onRequest)

    const removeRuntime = installEtaFfLifecycleRuntime()
    vi.advanceTimersByTime(1_000)

    expect(document.querySelector<HTMLElement>('.aman-flight-row')?.dataset.flightStatus).toBe('FROZEN')
    expect(requests).toEqual([{
      airport: 'VTBS',
      callsign: 'THA123',
      runway: '19',
      approachCategory: 'C',
      distanceNm: 9.8,
      trackAt: '2026-08-25T10:00:00.000Z',
    }])

    removeRuntime()
    window.removeEventListener('aman:frozen-target-request', onRequest)
    vi.useRealTimers()
  })

  it('does not category-recompute the four-minute fallback without final geometry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    document.body.innerHTML = `
      <div class="aman-flight-row" data-final-geometry-available="false" data-final-ten-nm="false"
        data-performance-category="C"
        title="ETA-FF 09:45:00Z · STA/TLDT 10:04:00Z · STA-FF/TTO 09:45:00Z · VTBS RWY 19">
        <span></span><strong>THA123</strong><span></span><span></span><span>09:45</span>
      </div>
    `
    const onRequest = vi.fn()
    window.addEventListener('aman:frozen-target-request', onRequest)
    const removeRuntime = installEtaFfLifecycleRuntime()
    vi.advanceTimersByTime(1_000)
    expect(document.querySelector<HTMLElement>('.aman-flight-row')?.dataset.frozenTrigger).toBe('TLDT_4MIN_FALLBACK')
    expect(onRequest).not.toHaveBeenCalled()
    removeRuntime()
    window.removeEventListener('aman:frozen-target-request', onRequest)
    vi.useRealTimers()
  })
})

describe('STABLE ETA lock', () => {
  it('keeps an AUTO ETA fixed from STABLE and advances status using the locked time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const etaCell = document.createElement('span')
    etaCell.textContent = '10:14'
    document.body.innerHTML = `
      <div class="aman-flight-row" data-final-geometry-available="true"
        title="ETA-FF 10:14:00Z · STA/TLDT 10:30:00Z · STA-FF/TTO 10:14:00Z · VTBS RWY 19">
        <span></span><strong>THA123</strong><span></span><span></span>
      </div>
    `
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    row.appendChild(etaCell)

    const removeRuntime = installEtaFfLifecycleRuntime()
    expect(row.dataset.flightStatus).toBe('STABLE')
    expect(row.dataset.etaFfLocked).toBe('true')
    expect(etaCell.textContent).toBe('10:14')

    row.title = 'ETA-FF 10:18:00Z · STA/TLDT 10:30:00Z · STA-FF/TTO 10:14:00Z · VTBS RWY 19'
    etaCell.textContent = '10:18'
    await Promise.resolve()
    await Promise.resolve()

    expect(row.dataset.flightStatus).toBe('STABLE')
    expect(etaCell.textContent).toBe('10:14')

    vi.advanceTimersByTime(10 * 60_000)
    expect(row.dataset.flightStatus).toBe('SUPERSTABLE')
    expect(etaCell.textContent).toBe('10:14')
    removeRuntime()
    vi.useRealTimers()
  })
})

describe('ground stage pushback detection', () => {
  function groundFlight(sessionId: string, groundSpeed: number, trackMs: number) {
    return flight({
      sessionId,
      state: 'Boarding',
      onGround: true,
      altitude: 0,
      groundSpeed,
      trackTimestamp: new Date(trackMs).toISOString(),
      filedDepartureTimeSeconds: 10 * 60 * 60,
      filedEetSeconds: 90 * 60,
    })
  }

  it('infers DEPARTING after two distinct moving samples while IVAO still says Boarding', () => {
    const first = estimateIawpArrival(groundFlight('pushback-two-samples', 3, now), geometry, 'NORTA', 15 * 60, new Date(now).toISOString())
    const secondMs = now + 15_000
    const second = estimateIawpArrival(groundFlight('pushback-two-samples', 3, secondMs), geometry, 'NORTA', 15 * 60, new Date(secondMs).toISOString())

    expect(first.reason).toContain('ETA STAGE BOARDING')
    expect(second.reason).toContain('ETA STAGE DEPARTING MOTION')
  })

  it('does not count the same IVAO track sample twice', () => {
    const sample = groundFlight('pushback-same-track', 3, now)
    const first = estimateIawpArrival(sample, geometry, 'NORTA', 15 * 60, new Date(now).toISOString())
    const repeated = estimateIawpArrival(sample, geometry, 'NORTA', 15 * 60, new Date(now + 15_000).toISOString())

    expect(first.reason).toContain('ETA STAGE BOARDING')
    expect(repeated.reason).toContain('ETA STAGE BOARDING')
  })

  it('infers DEPARTING immediately when ground speed is clearly above pushback speed', () => {
    const estimate = estimateIawpArrival(groundFlight('pushback-fast', 7, now), geometry, 'NORTA', 15 * 60, new Date(now).toISOString())
    expect(estimate.reason).toContain('ETA STAGE DEPARTING MOTION')
  })

  it('keeps DEPARTING latched after the aircraft stops and IVAO still says Boarding', () => {
    estimateIawpArrival(groundFlight('pushback-latch', 7, now), geometry, 'NORTA', 15 * 60, new Date(now).toISOString())
    const stoppedMs = now + 15_000
    const stopped = estimateIawpArrival(groundFlight('pushback-latch', 0, stoppedMs), geometry, 'NORTA', 15 * 60, new Date(stoppedMs).toISOString())

    expect(stopped.reason).toContain('ETA STAGE DEPARTING LATCHED')
    expect(stopped.reason).not.toContain('ETA STAGE BOARDING')
  })

  it('accepts IVAO Departing immediately without waiting for motion samples', () => {
    const estimate = estimateIawpArrival(flight({
      ...groundFlight('pushback-ivao', 0, now),
      state: 'Departing',
    }), geometry, 'NORTA', 15 * 60, new Date(now).toISOString())

    expect(estimate.reason).toContain('ETA STAGE DEPARTING IVAO')
  })
})

describe('dynamic ETA', () => {
  it('uses current position instead of full EET when the IVAO session begins airborne', () => {
    const estimate = estimateIawpArrival(flight({
      sessionId: 'mid-air-connect',
      departure: 'VHHH',
      isDomesticThailand: false,
      connectedAirborne: true,
      connectedAt: new Date(now - 60_000).toISOString(),
      latitude: 14.1,
      longitude: 102.0,
      altitude: 25_000,
      groundSpeed: 420,
      filedDepartureTimeSeconds: 8 * 60 * 60,
      filedEetSeconds: 3 * 60 * 60,
    }), null, 'EASTE', 19 * 60, new Date(now).toISOString())

    expect(estimate.source).toBe('LIVE_ROUTE')
    expect(estimate.reason).toContain('MID-AIR CONNECT DIRECT')
    expect(new Date(estimate.predictedIawpAt!).getTime()).toBeGreaterThan(now)
    expect(new Date(estimate.predictedIawpAt!).getTime()).toBeLessThan(now + 60 * 60_000)
  })

  it('does not apply the mid-air fallback to a normal session that connected on the ground', () => {
    const estimate = estimateIawpArrival(flight({
      sessionId: 'normal-airborne-session',
      connectedAirborne: false,
      latitude: 14.1,
      longitude: 102.0,
      groundSpeed: 420,
      filedDepartureTimeSeconds: 8 * 60 * 60,
      filedEetSeconds: 3 * 60 * 60,
    }), null, 'EASTE', 19 * 60, new Date(now).toISOString())

    expect(estimate.source).not.toBe('LIVE_ROUTE')
    expect(estimate.reason).not.toContain('MID-AIR CONNECT DIRECT')
  })

  it('latches the actual feeder-fix crossing instead of changing ETA after the STAR entry', () => {
    const first = estimateIawpArrival(flight({
      sessionId: 'passed-iawp',
      longitude: 1.2,
      groundSpeed: 300,
    }), crossedGeometry, 'NORTA', 0, new Date(now).toISOString())
    const laterSampleTime = now + 60_000
    const afterCrossing = estimateIawpArrival(flight({
      sessionId: 'passed-iawp',
      longitude: 1.5,
      groundSpeed: 100,
      trackTimestamp: new Date(laterSampleTime).toISOString(),
    }), crossedGeometry, 'NORTA', 0, new Date(laterSampleTime).toISOString())

    expect(first.pastCrossing).toBe(true)
    expect(afterCrossing.pastCrossing).toBe(true)
    expect(afterCrossing.predictedIawpAt).toBe(first.predictedIawpAt)
    expect(afterCrossing.reason).toContain('STABLE ETA LOCKED')
  })

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

  it('allows an UNSTABLE ETA to move later after a hold/vector slowdown at cruise altitude', () => {
    const first = estimateIawpArrival(flight({ groundSpeed: 400, longitude: 0 }), geometry, 'NORTA', 0, new Date(now).toISOString())
    const laterSampleTime = now + 60_000
    const slowed = estimateIawpArrival(flight({
      groundSpeed: 100,
      longitude: 0,
      trackTimestamp: new Date(laterSampleTime).toISOString(),
    }), geometry, 'NORTA', 0, new Date(laterSampleTime).toISOString())

    expect(first.source).toBe('LIVE_ROUTE')
    expect(slowed.source).toBe('LIVE_ROUTE')
    expect(new Date(slowed.predictedIawpAt!).getTime()).toBeGreaterThan(new Date(first.predictedIawpAt!).getTime())
    expect(slowed.reason).toContain('LIVE BOTH-DIRECTIONS')
  })

  it('does not move ETA after an AUTO flight enters STABLE', () => {
    const first = estimateIawpArrival(flight({
      sessionId: 'stable-auto',
      groundSpeed: 600,
      actualDepartureTimeSeconds: 35_400,
      filedEetSeconds: 1_200,
    }), geometry, 'NORTA', 0, new Date(now).toISOString())
    const laterSampleTime = now + 60_000
    const slowed = estimateIawpArrival(flight({
      sessionId: 'stable-auto',
      groundSpeed: 100,
      actualDepartureTimeSeconds: 35_400,
      filedEetSeconds: 1_200,
      trackTimestamp: new Date(laterSampleTime).toISOString(),
    }), geometry, 'NORTA', 0, new Date(laterSampleTime).toISOString())

    expect(new Date(first.predictedIawpAt!).getTime() - now).toBeLessThanOrEqual(15 * 60_000)
    expect(slowed.predictedIawpAt).toBe(first.predictedIawpAt)
    expect(slowed.reason).toContain('STABLE ETA LOCKED')
  })

  it('keeps an airborne flight provisional and unlocked while Actual Departure is pending', () => {
    const estimate = estimateIawpArrival(flight({
      sessionId: 'takeoff-pending',
      filedDepartureTimeSeconds: 34_200,
      filedEetSeconds: 3_600,
      groundSpeed: null,
      latitude: null,
      longitude: null,
      altitude: 2_000,
      trackTimestamp: new Date(now).toISOString(),
    } as Partial<IvaoArrivalTrafficFlight>), null, 'NORTA', 1_200, new Date(now).toISOString())

    expect(estimate.source).toBe('TRACKED_TAKEOFF_EET')
    expect(estimate.reason).toContain('ACTUAL TAKEOFF PENDING')
    expect(estimate.reason).not.toContain('STABLE ETA LOCKED')
    expect(new Date(estimate.predictedIawpAt!).getTime()).toBe(now + 40 * 60_000)

    const confirmed = estimateIawpArrival(flight({
      sessionId: 'takeoff-pending',
      filedDepartureTimeSeconds: 34_200,
      actualDepartureTimeSeconds: 36_300,
      filedEetSeconds: 3_600,
      groundSpeed: null,
      latitude: null,
      longitude: null,
      altitude: 2_000,
      trackTimestamp: new Date(now + 30_000).toISOString(),
    }), null, 'NORTA', 1_200, new Date(now + 30_000).toISOString())

    expect(confirmed.source).toBe('ACTUAL_DEPARTURE_EET')
    expect(new Date(confirmed.predictedIawpAt!).getTime()).toBe(now + 45 * 60_000)
  })
})
