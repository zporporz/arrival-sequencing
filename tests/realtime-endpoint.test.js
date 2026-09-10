import { describe, expect, it, vi } from 'vitest'
import { onRequestGet } from '../functions/api/sequence/realtime.js'

describe('authenticated realtime endpoint', () => {
  it.each(['VTCC', 'VTSP'])('routes %s into its own authenticated room', async airport => {
    const getByName = vi.fn(() => ({ fetch: async () => new Response('ok') }));
    const response = await onRequestGet({ request: new Request('https://app.test/api/sequence/realtime?serviceDate=2026-09-10&airport=' + airport, { headers: { Upgrade: 'websocket' } }), env: { AMAN_REALTIME: { getByName } }, data: { auth: { vid: 'LOCAL' } } });
    expect(response.status).toBe(200); expect(getByName).toHaveBeenCalledWith('v2:2026-09-10:' + airport);
  });
  it('rejects ordinary HTTP requests', async () => {
    const response = await onRequestGet({
      request: new Request('https://example.test/api/sequence/realtime?serviceDate=2026-08-25&airport=VTBS'),
      env: {},
      data: { auth: { vid: '1' } },
    })
    expect(response.status).toBe(426)
  })

  it('routes an authenticated WebSocket upgrade to the date and airport room', async () => {
    const fetch = vi.fn(async () => new Response('proxied'))
    const getByName = vi.fn(() => ({ fetch }))
    const request = new Request('https://example.test/api/sequence/realtime?serviceDate=2026-08-25&airport=VTBS', {
      headers: { Upgrade: 'websocket' },
    })
    const response = await onRequestGet({
      request,
      env: { AMAN_REALTIME: { getByName } },
      data: { auth: { vid: '739898', name: 'Controller' } },
    })

    expect(response.status).toBe(200)
    expect(getByName).toHaveBeenCalledWith('v2:2026-08-25:VTBS')
    const proxiedRequest = fetch.mock.calls[0][0]
    expect(proxiedRequest.headers.get('X-AMAN-VID')).toBe('739898')
    expect(proxiedRequest.headers.get('X-AMAN-Name')).toBe('Controller')
  })
})
