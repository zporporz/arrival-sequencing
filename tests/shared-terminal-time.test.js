import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectAutomaticMissedApproach,
  evaluateFinalObservation,
  looksLandedAtAirport,
  reconcileAmanFlights,
  utcServiceDate,
} from '../functions/_lib/amanSharedState.js'
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

function mockMutableFlightStateApi(initial = []) {
  const rows = initial.map((row) => ({ ...row }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') return jsonResponse(rows)
    const writes = JSON.parse(String(options.body || '[]'))
    const result = writes.map((write) => {
      const index = rows.findIndex((row) => row.service_date === write.service_date
        && row.airport === write.airport && row.callsign === write.callsign)
      const merged = { ...(index >= 0 ? rows[index] : {}), ...write }
      if (index >= 0) rows[index] = merged
      else rows.push(merged)
      return merged
    })
    return jsonResponse(result)
  })
  return rows
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

  it('keeps a centrally marked GA visible while IVAO is briefly still LANDED', async () => {
    mockMutableFlightStateApi([{
      service_date: '2026-08-25',
      airport: 'VTBS',
      callsign: 'THA777',
      canonical_session_id: 'canonical-session',
      raw_session_id: 'raw-session',
      operational_state: 'NORMAL',
      target_mode: 'MANUAL',
      manual_tldt: '2026-08-25T10:10:00.000Z',
      manual_runway: '19',
      manual_updated_at: '2026-08-25T10:00:00.000Z',
      missed_approach_active: true,
      missed_approach_source: 'MANUAL',
      missed_approach_detected_at: '2026-08-25T10:00:00.000Z',
      missed_approach_expires_at: '2026-08-25T10:45:00.000Z',
      last_seen_at: '2026-08-25T09:59:45.000Z',
      snapshot: { state: 'landed', onGround: true, trackTimestamp: '2026-08-25T09:59:45.000Z' },
    }])

    const flights = await reconcileAmanFlights(env, 'VTBS', [{
      callsign: 'THA777',
      sessionId: 'raw-session',
      state: 'landed',
      onGround: true,
      arrival: 'VTBS',
      latitude: 13.6811,
      longitude: 100.7473,
      groundSpeed: 0,
      trackTimestamp: '2026-08-25T10:00:20.000Z',
    }], '2026-08-25T10:00:30.000Z')

    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({
      callsign: 'THA777',
      state: 'initial climb',
      onGround: false,
      operationalReinsert: true,
      targetMode: 'MANUAL',
      manualTldt: '2026-08-25T10:10:00.000Z',
      missedApproachActive: true,
    })
  })
})

describe('automatic go-around detection', () => {
  const finalTrack = {
    callsign: 'THA456',
    sessionId: 'raw-session',
    arrival: 'VTBS',
    state: 'approach',
    onGround: false,
    latitude: 13.772,
    longitude: 100.781,
    heading: 194.42,
    altitude: 1_000,
    verticalSpeedFpm: -600,
    groundSpeed: 150,
    trackTimestamp: '2026-08-25T10:00:00.000Z',
  }

  it('recognizes an aligned VTBS final and rejects an ordinary descent as GA', () => {
    expect(evaluateFinalObservation('VTBS', finalTrack)).toMatchObject({ runway: '19' })
    expect(detectAutomaticMissedApproach({
      ga_armed_at: '2026-08-25T10:00:00.000Z',
      ga_armed_runway: '19',
      ga_armed_altitude_ft: 1_000,
      snapshot: finalTrack,
    }, {
      ...finalTrack,
      trackTimestamp: '2026-08-25T10:00:15.000Z',
      altitude: 900,
      verticalSpeedFpm: -500,
    }, 'VTBS', Date.parse('2026-08-25T10:00:15.000Z'))).toBeNull()
  })

  it('arms on final, then persists a climbing transition as a shared AUTO GA target', async () => {
    const rows = mockMutableFlightStateApi()
    await reconcileAmanFlights(env, 'VTBS', [finalTrack], '2026-08-25T10:00:05.000Z')
    expect(rows[0]).toMatchObject({ ga_armed_runway: '19', missed_approach_active: false })

    const flights = await reconcileAmanFlights(env, 'VTBS', [{
      ...finalTrack,
      state: 'initial climb',
      altitude: 1_200,
      verticalSpeedFpm: 900,
      trackTimestamp: '2026-08-25T10:00:20.000Z',
    }], '2026-08-25T10:00:25.000Z')

    expect(rows[0]).toMatchObject({
      missed_approach_active: true,
      missed_approach_source: 'AUTO',
      target_mode: 'MANUAL',
      manual_tldt: '2026-08-25T10:10:25.000Z',
      manual_runway: '19',
      frozen_tldt: null,
    })
    expect(flights[0]).toMatchObject({
      callsign: 'THA456',
      targetMode: 'MANUAL',
      manualTldt: '2026-08-25T10:10:25.000Z',
      missedApproachActive: true,
      missedApproachSource: 'AUTO',
    })
  })

  it('uses a recent shared FROZEN capture when the controller opens after the climb started', () => {
    expect(detectAutomaticMissedApproach({
      frozen_captured_at: '2026-08-25T10:00:00.000Z',
      frozen_track_at: '2026-08-25T10:00:00.000Z',
      frozen_runway: '19',
      snapshot: { ...finalTrack, altitude: 950 },
    }, {
      ...finalTrack,
      state: 'initial climb',
      altitude: 1_250,
      verticalSpeedFpm: 1_000,
      trackTimestamp: '2026-08-25T10:01:00.000Z',
    }, 'VTBS', Date.parse('2026-08-25T10:01:05.000Z'))).toMatchObject({ runway: '19' })
  })

  it('writes full live rows and partial ghost rows in separate uniform batches', async () => {
    const existing = [{
      service_date: '2026-08-25',
      airport: 'VTBS',
      callsign: 'OLD123',
      canonical_session_id: 'old-canonical',
      raw_session_id: 'old-raw',
      last_seen_at: '2026-08-25T09:59:50.000Z',
      connection_phase: 'LIVE',
      snapshot: {
        state: 'en route',
        onGround: false,
        latitude: 14.5,
        longitude: 100.7,
        groundSpeed: 300,
        trackTimestamp: '2026-08-25T09:59:50.000Z',
      },
    }]
    const postBodies = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options = {}) => {
      if (!options.method || options.method === 'GET') return jsonResponse(existing)
      const writes = JSON.parse(String(options.body || '[]'))
      postBodies.push(writes)
      const signatures = new Set(writes.map((row) => Object.keys(row).sort().join('|')))
      if (signatures.size !== 1) return new Response(JSON.stringify({ message: 'All object keys must match' }), { status: 400 })
      return jsonResponse(writes)
    })

    await expect(reconcileAmanFlights(env, 'VTBS', [finalTrack], '2026-08-25T10:00:05.000Z'))
      .resolves.toHaveLength(2)
    expect(postBodies).toHaveLength(2)
    expect(postBodies.every((batch) => new Set(batch.map((row) => Object.keys(row).sort().join('|'))).size === 1)).toBe(true)
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

  it('sends the original AUTO position with the first manual drag', async () => {
    const requests = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options = {}) => {
      if (!options.method || options.method === 'GET') {
        return jsonResponse({
          serviceDate: new Date().toISOString().slice(0, 10),
          workspaceStates: [],
          flightStates: [],
          sequenceOrders: [],
        })
      }
      const body = JSON.parse(String(options.body || '{}'))
      requests.push(body)
      return jsonResponse({
        ok: true,
        flightState: {
          service_date: body.serviceDate,
          airport: body.airport,
          callsign: body.callsign,
          target_mode: 'MANUAL',
          manual_tldt: body.manualTldt,
          manual_runway: body.manualRunway,
          revision: 2,
        },
      })
    })
    document.body.innerHTML = `
      <div class="aman-flight-row" data-target-mode="AUTO"
        data-auto-baseline-tldt="2026-08-28T10:15:00.000Z"
        data-auto-baseline-runway="19" data-auto-baseline-rank="3"
        title="VTBS RWY 19" style="--offset-px:-100px">
        <span class="tldt">10:15</span><strong>THA123</strong>
        <em class="runway-assignment"><select><option selected>19</option></select></em>
      </div>
    `

    const removeRuntime = installSharedAmanRuntime()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const callsign = document.querySelector('strong')
    callsign.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    callsign.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      action: 'setManualTarget',
      airport: 'VTBS',
      callsign: 'THA123',
      manualRunway: '19',
      autoBaselineTldt: '2026-08-28T10:15:00.000Z',
      autoBaselineRunway: '19',
      autoBaselineRank: 3,
    })

    removeRuntime()
    document.body.innerHTML = ''
  })
})
