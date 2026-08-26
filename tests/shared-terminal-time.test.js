import { afterEach, describe, expect, it, vi } from 'vitest'
import { looksLandedAtAirport, reconcileAmanFlights, utcServiceDate } from '../functions/_lib/amanSharedState.js'
import { isLocalPredeparturePilot } from '../functions/api/sequence/ivao-traffic.js'
import { secondsOfDayToNearestUtc } from '../src/core/arrivalEta'
import { installSharedAmanRuntime } from '../src/sharedAmanRuntime'

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFlightStateApi(existing = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') return jsonResponse(existing)
    return jsonResponse(JSON.parse(String(options.body || '[]')))
  })
}

afterEach(() => vi.restoreAllMocks())

describe('terminal flight protection', () => {
  it.each(['on blocks', 'on ground', 'boarding'])('keeps a pre-departure %s flight inbound when it is away from the destination', (state) => {
    const pilot = {
      callsign: 'TLM1',
      flightPlan: { departureId: 'VTCC', arrivalId: 'VTBS' },
      lastTrack: {
        state,
        onGround: true,
        latitude: 18.7668,
        longitude: 98.9626,
        groundSpeed: 0,
      },
    }

    expect(looksLandedAtAirport(pilot.lastTrack, 'VTBS')).toBe(false)
  })

  it('removes an on-blocks flight only when it is at the destination airport', () => {
    const pilot = {
      callsign: 'TLM1',
      flightPlan: { departureId: 'VTCC', arrivalId: 'VTBS' },
      lastTrack: {
        state: 'on blocks',
        onGround: true,
        latitude: 13.6811,
        longitude: 100.7473,
        groundSpeed: 0,
      },
    }

    expect(looksLandedAtAirport(pilot.lastTrack, 'VTBS')).toBe(true)
  })

  it('keeps a same-airport flight at the gate before its first takeoff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([
      { onGround: true, timestamp: '2026-08-26T03:55:00.000Z' },
      { onGround: true, timestamp: '2026-08-26T04:00:00.000Z' },
    ]))
    const pilot = {
      id: 'local-predeparture',
      flightPlan: { departureId: 'VTBS', arrivalId: 'VTBS' },
      lastTrack: { state: 'on blocks', onGround: true, latitude: 13.6811, longitude: 100.7473, groundSpeed: 0 },
    }

    expect(await isLocalPredeparturePilot(pilot, 'VTBS', { IVAO_API_KEY: 'test' })).toBe(true)
  })

  it('removes a same-airport flight after track history proves it took off and returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([
      { onGround: true, timestamp: '2026-08-26T02:00:00.000Z' },
      { onGround: false, timestamp: '2026-08-26T02:10:00.000Z' },
      { onGround: true, timestamp: '2026-08-26T03:30:00.000Z' },
    ]))
    const pilot = {
      id: 'local-completed',
      flightPlan: { departureId: 'VTBS', arrivalId: 'VTBS' },
      lastTrack: { state: 'on blocks', onGround: true, latitude: 13.6811, longitude: 100.7473, groundSpeed: 0 },
    }

    expect(await isLocalPredeparturePilot(pilot, 'VTBS', { IVAO_API_KEY: 'test' })).toBe(false)
  })

  it('keeps an ambiguous same-airport predeparture visible when track history is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('tracker unavailable'))
    const pilot = {
      id: 'local-track-error',
      flightPlan: { departureId: 'VTBS', arrivalId: 'VTBS' },
      lastTrack: { state: 'on blocks', onGround: true, latitude: 13.6811, longitude: 100.7473, groundSpeed: 0 },
    }

    expect(await isLocalPredeparturePilot(pilot, 'VTBS', { IVAO_API_KEY: 'test' })).toBe(true)
  })

  it('does not suppress a confirmed same-airport predeparture during shared-state reconciliation', async () => {
    mockFlightStateApi()
    const flights = await reconcileAmanFlights(env, 'VTBS', [{
      callsign: 'LOC101',
      sessionId: 'local-shared-state',
      departure: 'VTBS',
      arrival: 'VTBS',
      state: 'on blocks',
      onGround: true,
      latitude: 13.6811,
      longitude: 100.7473,
      groundSpeed: 0,
      predepartureLocal: true,
      trackTimestamp: '2026-08-26T04:00:00.000Z',
    }], '2026-08-26T04:00:10.000Z')

    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({ callsign: 'LOC101', predepartureLocal: true })
  })

  it.each(['landed', 'on ground', 'on blocks'])('does not reinsert a terminal %s flight', async (state) => {
    mockFlightStateApi()
    const flights = await reconcileAmanFlights(env, 'VTBS', [{
      callsign: 'THA999',
      sessionId: 'raw-session',
      state,
      onGround: state === 'on ground',
      arrival: 'VTBS',
      latitude: 13.6811,
      longitude: 100.7473,
      groundSpeed: 0,
      trackTimestamp: '2026-08-25T10:00:00.000Z',
    }], '2026-08-25T10:00:10.000Z')

    expect(flights).toEqual([])
  })

  it('does not let an old pre-landing manual target resurrect a landed flight', async () => {
    mockFlightStateApi([{
      service_date: '2026-08-25',
      airport: 'VTBS',
      callsign: 'THA888',
      canonical_session_id: 'canonical-session',
      raw_session_id: 'old-raw-session',
      target_mode: 'MANUAL',
      manual_tldt: '2026-08-25T10:30:00.000Z',
      manual_updated_at: '2026-08-25T09:50:00.000Z',
      last_seen_at: '2026-08-25T09:59:00.000Z',
      snapshot: { state: 'approach', onGround: false, trackTimestamp: '2026-08-25T09:59:00.000Z' },
    }])

    const flights = await reconcileAmanFlights(env, 'VTBS', [{
      callsign: 'THA888',
      sessionId: 'new-raw-session',
      state: 'landed',
      onGround: true,
      arrival: 'VTBS',
      latitude: 13.6811,
      longitude: 100.7473,
      groundSpeed: 0,
      trackTimestamp: '2026-08-25T10:00:00.000Z',
    }], '2026-08-25T10:00:10.000Z')

    expect(flights).toEqual([])
  })
})

describe('UTC midnight rollover', () => {
  it('resolves seconds-of-day to the nearest UTC date in both directions', () => {
    expect(secondsOfDayToNearestUtc(23 * 3600 + 59 * 60, '2026-08-25T00:01:00.000Z'))
      .toBe('2026-08-24T23:59:00.000Z')
    expect(secondsOfDayToNearestUtc(60, '2026-08-25T23:59:00.000Z'))
      .toBe('2026-08-26T00:01:00.000Z')
  })

  it('uses the UTC calendar date for shared AMAN service state', () => {
    expect(utcServiceDate('2026-08-25T23:59:59-07:00')).toBe('2026-08-26')
    expect(utcServiceDate('2026-08-25T00:00:01+07:00')).toBe('2026-08-24')
  })
})

describe('forced shared refresh', () => {
  it('fetches shared state immediately when GA/reinsert dispatches the event', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      serviceDate: '2026-08-25',
      workspaceStates: [],
      flightStates: [],
      sequenceOrders: [],
    }))
    const removeRuntime = installSharedAmanRuntime()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new CustomEvent('aman:force-shared-refresh'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    removeRuntime()
  })
})
