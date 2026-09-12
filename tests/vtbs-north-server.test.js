import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/sequence/aman-state.js'
import { evaluateFinalObservation, detectAutomaticMissedApproach } from '../functions/_lib/amanSharedState.js'
import { BANGKOK_FINAL_GEOMETRY } from '../functions/_lib/bangkokFinalGeometry.js'
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js'
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }))

const serviceDate = '2026-09-12'
function command(body) {
  return onRequestPost({ env: {}, data: { auth: { vid: '1', name: 'Test' } }, request: new Request('https://local.test/api/sequence/aman-state', {
    method: 'POST', body: JSON.stringify({ serviceDate, airport: 'VTBS', ...body }),
  }) })
}
beforeEach(() => vi.resetAllMocks())

describe('VTBS north-flow shared state', () => {
  it('persists CUSTOM north flow and explicitly closes the reciprocal ends', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ revision: 2 }] })
    const response = await command({ action: 'syncWorkspace', profileId: 'CUSTOM',
      runwayModes: { '01': 'MIX', '02L': 'ARR', '02R': 'DEP' }, spacingNm: { '01': 5.5, '02L': 6, '02R': 8 }, settings: {} })
    expect(response.status).toBe(200)
    expect(JSON.parse(supabaseAdminRequest.mock.calls[0][2].body)[0]).toMatchObject({
      airport: 'VTBS', settings: { runwayFlow: '01_02' }, runway_modes: { '01': 'MIX', '02L': 'ARR', '02R': 'DEP', '19': 'CLOSED', '20L': 'CLOSED', '20R': 'CLOSED' },
    })
  })
  it('rejects simultaneous opposite directions without writing', async () => {
    const response = await command({ action: 'syncWorkspace', profileId: 'CUSTOM', runwayModes: { '01': 'ARR', '19': 'ARR' }, spacingNm: {}, settings: {} })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('one runway direction')
    expect(supabaseAdminRequest).not.toHaveBeenCalled()
  })
  it('keeps all-CLOSED north flow identifiable for late joiners', async () => {
    supabaseAdminRequest.mockResolvedValue({ data: [{ revision: 2 }] })
    expect((await command({ action: 'syncWorkspace', profileId: 'CUSTOM', runwayModes: { '01': 'CLOSED', '02L': 'CLOSED', '02R': 'CLOSED' }, spacingNm: {}, settings: {} })).status).toBe(200)
    expect(JSON.parse(supabaseAdminRequest.mock.calls[0][2].body)[0].settings.runwayFlow).toBe('01_02')
  })
  it('recaptures the north Frozen target with revision protection after a runway change', async () => {
    const previous = { service_date: serviceDate, airport: 'VTBS', callsign: 'THA123', revision: 4, frozen_tldt: '2026-09-12T10:00:00Z', frozen_runway: '19' }
    supabaseAdminRequest.mockResolvedValueOnce({ data: [previous] }).mockImplementationOnce(async (_env, _path, options) => ({ data: [{ ...previous, ...JSON.parse(options.body), revision: 5 }] }))
    const response = await command({ action: 'setFrozenTarget', callsign: 'THA123', runway: '01', approachCategory: 'C', distanceNm: 5, trackAt: new Date().toISOString() })
    expect(response.status).toBe(200)
    expect((await response.json()).flightState).toMatchObject({ frozen_runway: '01', revision: 5 })
    expect(supabaseAdminRequest.mock.calls[1][1]).toContain('revision=eq.4')
  })
  it('does not recalculate an already captured same-runway Frozen target', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ airport: 'VTBS', callsign: 'THA123', frozen_tldt: '2026-09-12T10:00:00Z', frozen_runway: '01' }] })
    expect((await command({ action: 'setFrozenTarget', callsign: 'THA123', runway: '01' })).status).toBe(200)
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1)
  })
  it.each(['01', '02L', '02R'])('detects %s final and subsequent automatic GA with the same geometry as the browser', runway => {
    const now = Date.now(), g = BANGKOK_FINAL_GEOMETRY[`VTBS:${runway}`], rad = g.course * Math.PI / 180
    const final = { latitude: g.lat - Math.cos(rad) * 5 / 60, longitude: g.lon - Math.sin(rad) * 5 / (60 * Math.cos(g.lat * Math.PI / 180)),
      heading: g.course, onGround: false, altitude: 1500, verticalSpeedFpm: -700, state: 'approach', trackTimestamp: new Date(now).toISOString() }
    expect(evaluateFinalObservation('VTBS', final)).toMatchObject({ runway })
    const armed = { ga_armed_at: new Date(now - 30_000).toISOString(), ga_armed_runway: runway, ga_armed_altitude_ft: 900, snapshot: { altitude: 900 } }
    expect(detectAutomaticMissedApproach(armed, { ...final, altitude: 1800, verticalSpeedFpm: 1000, state: 'initial climb' }, 'VTBS', now)).toMatchObject({ runway })
    expect(detectAutomaticMissedApproach(armed, final, 'VTBS', now)).toBeNull()
  })
})
