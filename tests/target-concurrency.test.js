import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/sequence/aman-state.js'
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js'
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }))

const identity = { service_date: '2026-09-08', airport: 'VTBS', callsign: 'THA123', canonical_session_id: 'test' }
function command(action, expectedRevision, expectedTargetRevision) {
  return onRequestPost({ env: {}, data: { auth: { vid: '1', name: 'Test' } }, request: new Request('https://local.test/api/sequence/aman-state', {
    method: 'POST', body: JSON.stringify({ action, serviceDate: identity.service_date, airport: identity.airport, callsign: identity.callsign,
      expectedRevision, expectedTargetRevision, manualTldt: '2026-09-08T10:20:00Z', manualRunway: '19', autoTldt: '2026-09-08T10:10:00Z', autoFloorTldt: '2026-09-08T10:10:00Z', autoRunway: '19' }),
  }) })
}
beforeEach(() => vi.clearAllMocks())

describe('atomic target writes', () => {
  it.each(['setManualTarget', 'clearManualTarget'])('accepts %s across telemetry changes using target CAS', async action => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 1054, target_revision: 0 }] })
      .mockResolvedValueOnce({ data: [{ ...identity, revision: 1060, target_revision: 1 }] })
    const response = await command(action, 1030, 0)
    expect(response.status).toBe(200)
    expect(supabaseAdminRequest.mock.calls[1][1]).toContain('&target_revision=eq.0&')
    expect(supabaseAdminRequest.mock.calls[1][1]).not.toContain('&revision=')
  })
  it.each(['setManualTarget', 'clearManualTarget'])('rejects a conflicting controller %s without retrying', async action => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 100, target_revision: 7 }] })
      .mockResolvedValueOnce({ data: [] })
    expect((await command(action, 100, 6)).status).toBe(409)
    expect(supabaseAdminRequest.mock.calls[1][1]).toContain('&target_revision=eq.6&')
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(2)
  })
  it.each([-1, null, '0', 1.2])('does not fall back to weaker row CAS for invalid target version %s', async version => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 9, target_revision: 1 }] })
    expect((await command('setManualTarget', 9, version)).status).toBe(409)
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1)
  })
  it('keeps insert-if-absent atomic with target revision zero', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] })
    expect((await command('setManualTarget', 0, 0)).status).toBe(409)
    expect(supabaseAdminRequest.mock.calls[1][2].headers.Prefer).toContain('ignore-duplicates')
  })
  it.each(['setManualTarget', 'clearManualTarget'])('rejects a stale %s without an unconditional retry', async action => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 9 }] }).mockResolvedValueOnce({ data: [] })
    const response = await command(action, 8)
    expect(response.status).toBe(409)
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(2)
    expect(supabaseAdminRequest.mock.calls[1][1]).toContain('revision=eq.8')
    expect(supabaseAdminRequest.mock.calls[1][2].method).toBe('PATCH')
  })
  it('accepts a matching revision and preserves database-issued revision', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 9 }] }).mockResolvedValueOnce({ data: [{ ...identity, revision: 10, target_mode: 'MANUAL' }] })
    const response = await command('setManualTarget', 9)
    expect(response.status).toBe(200)
    expect((await response.json()).flightState.revision).toBe(10)
  })
  it('does not overwrite a concurrent first insertion', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] })
    expect((await command('setManualTarget', 0)).status).toBe(409)
    expect(supabaseAdminRequest.mock.calls[1][2].headers.Prefer).toContain('ignore-duplicates')
  })
  it('requires a revision', async () => {
    supabaseAdminRequest.mockResolvedValueOnce({ data: [{ ...identity, revision: 9 }] })
    expect((await command('setManualTarget', undefined)).status).toBe(409)
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1)
  })
})
