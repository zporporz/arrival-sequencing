import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/sequence/aman-state.js'
import { evaluateFinalObservation, detectAutomaticMissedApproach } from '../functions/_lib/amanSharedState.js'
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry.js'
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js'
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }))

const serviceDate = '2026-09-12'
function command(body) {
  return onRequestPost({ env: {}, data: { auth: { vid: '1', name: 'Test' } }, request: new Request('https://local.test/api/sequence/aman-state', {
    method: 'POST', body: JSON.stringify({ serviceDate, airport: 'VTBD', ...body }),
  }) })
}
beforeEach(() => vi.resetAllMocks())

describe('VTBD 03 shared state and Frozen', () => {
  it('persists CUSTOM 03 while explicitly closing 21, without creating separate workspaces', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ revision: 2 }] })
    expect((await command({ action: 'syncWorkspace', profileId: 'CUSTOM',
      runwayModes: { '03L': 'ARR', '03R': 'DEP' }, spacingNm: { '03L': 5, '03R': 7.1 }, settings: {} })).status).toBe(200)
    expect(supabaseAdminRequest.mock.calls[0][1]).toContain('on_conflict=service_date,airport')
    expect(JSON.parse(supabaseAdminRequest.mock.calls[0][2].body)[0]).toMatchObject({
      airport: 'VTBD', settings: { runwayFlow: '03' }, runway_modes: { '03L': 'ARR', '03R': 'DEP', '21R': 'CLOSED', '21L': 'CLOSED' },
    })
  })
  it.each([
    { runwayModes: { '03L': 'ARR', '21R': 'ARR' }, settings: {} },
    { runwayModes: { '21L': 'ARR' }, settings: { runwayFlow: '03' } },
  ])('rejects opposite-direction active runways without writing: %j', async input => {
    expect((await command({ action: 'syncWorkspace', profileId: 'CUSTOM', spacingNm: {}, ...input })).status).toBe(400)
    expect(supabaseAdminRequest).not.toHaveBeenCalled()
  })
  it('keeps an all-CLOSED 03 configuration identifiable to late joiners', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ revision: 2 }] })
    expect((await command({ action: 'syncWorkspace', profileId: 'CUSTOM', runwayModes: { '03L': 'CLOSED', '03R': 'CLOSED' }, spacingNm: {}, settings: {} })).status).toBe(200)
    expect(JSON.parse(supabaseAdminRequest.mock.calls[0][2].body)[0].settings.runwayFlow).toBe('03')
  })
  it.each([['C', 140], ['D', 165]])('recaptures 03 Frozen using category %s at 10 NM, not the old 21 target', async (category, speed) => {
    const previous = { service_date: serviceDate, airport: 'VTBD', callsign: 'AIQ123', revision: 4, frozen_tldt: '2026-09-12T10:00:00Z', frozen_runway: '21R' }
    supabaseAdminRequest.mockResolvedValueOnce({ data: [previous] }).mockImplementationOnce(async (_env, _path, options) => ({ data: [{ ...previous, ...JSON.parse(options.body), revision: 5 }] }))
    const trackAt = new Date().toISOString()
    const response = await command({ action: 'setFrozenTarget', callsign: 'AIQ123', runway: '03L', approachCategory: category, distanceNm: 10, trackAt })
    expect(response.status).toBe(200)
    const result = (await response.json()).flightState
    expect(result).toMatchObject({ frozen_runway: '03L', revision: 5, frozen_reference_speed_kt: speed })
    expect(Date.parse(result.frozen_tldt) - Date.parse(trackAt)).toBeCloseTo(Math.floor(10 / speed * 3600000), 0)
    expect(supabaseAdminRequest.mock.calls[1][1]).toContain('revision=eq.4')
  })
  it('returns the canonical winner if another client has already recaptured Frozen', async () => {
    const previous = { airport: 'VTBD', callsign: 'AIQ123', revision: 4, frozen_tldt: '2026-09-12T10:00:00Z', frozen_runway: '21R' }
    const winner = { ...previous, revision: 5, frozen_tldt: '2026-09-12T10:04:00Z', frozen_runway: '03L' }
    supabaseAdminRequest.mockResolvedValueOnce({ data: [previous] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [winner] })
    const response = await command({ action: 'setFrozenTarget', callsign: 'AIQ123', runway: '03L', approachCategory: 'C', distanceNm: 5, trackAt: new Date().toISOString() })
    expect((await response.json()).flightState).toEqual(winner)
  })
  it.each(['21R', '03L', '03R'])('does not recalculate the same-runway %s Frozen target', async runway => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ airport: 'VTBD', callsign: 'AIQ123', frozen_tldt: '2026-09-12T10:00:00Z', frozen_runway: runway }] })
    expect((await command({ action: 'setFrozenTarget', callsign: 'AIQ123', runway })).status).toBe(200)
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1)
  })
  it.each(['03L', '03R'])('detects %s Final and automatic GA using the browser geometry', runway => {
    const now = Date.now(), g = BANGKOK_FINAL_GEOMETRY[`VTBD:${runway}`], rad = g.course * Math.PI / 180
    const final = { latitude: g.lat - Math.cos(rad) * 5 / 60, longitude: g.lon - Math.sin(rad) * 5 / (60 * Math.cos(g.lat * Math.PI / 180)),
      heading: g.course, onGround: false, altitude: 1500, verticalSpeedFpm: -700, state: 'approach', trackTimestamp: new Date(now).toISOString() }
    expect(evaluateFinalObservation('VTBD', final)).toMatchObject({ runway })
    const armed = { ga_armed_at: new Date(now - 30000).toISOString(), ga_armed_runway: runway, ga_armed_altitude_ft: 900, snapshot: { altitude: 900 } }
    expect(detectAutomaticMissedApproach(armed, { ...final, altitude: 1800, verticalSpeedFpm: 1000, state: 'initial climb' }, 'VTBD', now)).toMatchObject({ runway })
    expect(detectAutomaticMissedApproach(armed, final, 'VTBD', now)).toBeNull()
  })
})
