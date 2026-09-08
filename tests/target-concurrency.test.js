import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/sequence/aman-state.js'
import { supabaseAdminRequest } from '../functions/_lib/supabaseAdmin.js'
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: vi.fn() }))

const identity = { service_date: '2026-09-08', airport: 'VTBS', callsign: 'THA123', canonical_session_id: 'test' }
function command(action, expectedRevision) {
  return onRequestPost({ env: {}, data: { auth: { vid: '1', name: 'Test' } }, request: new Request('https://local.test/api/sequence/aman-state', {
    method: 'POST', body: JSON.stringify({ action, serviceDate: identity.service_date, airport: identity.airport, callsign: identity.callsign,
      expectedRevision, manualTldt: '2026-09-08T10:20:00Z', manualRunway: '19', autoTldt: '2026-09-08T10:10:00Z', autoFloorTldt: '2026-09-08T10:10:00Z', autoRunway: '19' }),
  }) })
}
beforeEach(() => vi.clearAllMocks())

describe('atomic target writes', () => {
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
