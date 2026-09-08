import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/sequence/_middleware.js'
import { getRequestSession } from '../functions/_lib/session.js'
import { realtimeSession } from '../functions/_lib/realtimeAuthority.js'
vi.mock('../functions/_lib/session.js', async importOriginal => ({ ...await importOriginal(), getRequestSession: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('server-owned realtime publication', () => {
  it('publishes the database response instead of request-supplied state', async () => {
    getRequestSession.mockResolvedValue({ vid: '1' })
    const stored = { airport: 'VTBS', service_date: '2026-09-08', callsign: 'THA123', revision: 8 }
    const send = vi.fn(async () => new Response(null, { status: 204 }))
    const response = await onRequest({
      request: new Request('https://app.test/api/sequence/aman-state', { method: 'POST', body: JSON.stringify({ flightState: { ...stored, revision: 99999 } }) }),
      env: { AMAN_REALTIME: { getByName: () => ({ fetch: send }) } }, data: {},
      next: async () => Response.json({ flightState: stored }),
    })
    expect(response.status).toBe(200)
    expect(await send.mock.calls[0][0].json()).toEqual({ type: 'flight_commit', flightState: stored })
  })
  it('does not execute or publish unauthenticated requests', async () => {
    getRequestSession.mockResolvedValue(null)
    const next = vi.fn()
    expect((await onRequest({ request: new Request('https://app.test'), env: {}, data: {}, next })).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
  it('bounds socket lifetime by both idle and absolute expiration', () => {
    const session = { vid: '1', createdAt: '2026-09-08T00:00:00Z', lastActivityAt: '2026-09-08T07:00:00Z', isThailandStaff: true }
    expect(realtimeSession(session).expiresAt).toBe(Date.parse('2026-09-08T08:00:00Z'))
    expect(realtimeSession({ ...session, lastActivityAt: '2026-09-08T01:00:00Z' }).expiresAt).toBe(Date.parse('2026-09-08T03:00:00Z'))
  })
})
