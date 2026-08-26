import { afterEach, describe, expect, it, vi } from 'vitest'
import { looksLandedAtAirport, reconcileAmanFlights, utcServiceDate } from '../functions/_lib/amanSharedState.js'
import { isInboundPilotForAirport } from '../functions/api/sequence/ivao-traffic.js'
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

    expect(isInboundPilotForAirport(pilot, 'VTBS')).toBe(true)
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

    expect(isInboundPilotForAirport(pilot, 'VTBS')).toBe(false)
    expect(looksLandedAtAirport(pilot.lastTrack, 'VTBS')).toBe(true)
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
