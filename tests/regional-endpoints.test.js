import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bundle from '../functions/_data/regional-arrivals.json'
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), reconcile: vi.fn(), landed: vi.fn() }))
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({ supabaseAdminRequest: mocks.db }))
vi.mock('../functions/_lib/session.js', () => ({ getRequestSession: mocks.session }))
vi.mock('../functions/_lib/amanSharedState.js', () => ({ reconcileAmanFlights: mocks.reconcile, looksLandedAtAirport: mocks.landed }))
import { onRequestGet as navdata } from '../functions/api/sequence/regional-navdata.js'
import { onRequestGet as traffic } from '../functions/api/sequence/ivao-traffic.js'
import { onRequest as authenticate } from '../functions/api/sequence/_middleware.js'
const context = (url) => ({ request: new Request(`https://example.test/api/sequence/${url}`), env: { IVAO_API_KEY: 'test-only' }, data: {} })
describe('regional preview boundaries', () => {
  beforeEach(() => {
    mocks.db.mockResolvedValue({ data: [{ cycle: bundle.cycle, source_sha256: bundle.sourceSha256 }] })
    mocks.reconcile.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ clients: { pilots: [] } })))
  })
  afterEach(() => vi.unstubAllGlobals())
  it('serves only an exact matching active cycle and source', async () => {
    const response = await navdata(context('regional-navdata?airport=VTCC'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const data = await response.json()
    expect(data.airport.code).toBe('VTCC')
    expect(data.cycle).toBe(bundle.cycle)
    expect(mocks.db.mock.calls[0][2]).toBeUndefined() // read only
  })
  it('rejects unsupported airports, different cycle/hash, and database outage', async () => {
    expect((await navdata(context('regional-navdata?airport=VTBD'))).status).toBe(400)
    mocks.db.mockResolvedValue({ data: [{ cycle: '2610', source_sha256: bundle.sourceSha256 }] })
    expect((await navdata(context('regional-navdata?airport=VTCC'))).status).toBe(409)
    mocks.db.mockResolvedValue({ data: [{ cycle: bundle.cycle, source_sha256: 'different' }] })
    expect((await navdata(context('regional-navdata?airport=VTSP'))).status).toBe(409)
    mocks.db.mockRejectedValue(new Error('unavailable'))
    expect((await navdata(context('regional-navdata?airport=VTSP'))).status).toBe(503)
  })
  it('does not serve navdata before authenticating', async () => {
    mocks.session.mockResolvedValue(null)
    const next = vi.fn()
    const response = await authenticate({ ...context('regional-navdata?airport=VTCC'), next })
    expect(response.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
  it.each(['VTCC', 'VTSP'])('does not reconcile/write shared records for %s preview', async (airport) => {
    const response = await traffic(context(`ivao-traffic?airport=${airport}&mode=regional-preview`))
    expect(response.status).toBe(200)
    expect(mocks.reconcile).not.toHaveBeenCalled()
  })
  it.each(['VTBD', 'VTBS'])('preserves %s operational reconciliation even with a preview query', async (airport) => {
    await traffic(context(`ivao-traffic?airport=${airport}&mode=regional-preview`))
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.anything(), airport, [], expect.any(String))
  })
})
