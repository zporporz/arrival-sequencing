import { beforeEach, describe, expect, it, vi } from 'vitest'
import bundle from '../functions/_data/regional-arrivals.json'
import type { RegionalNavPayload } from '../src/core/regionalArrivalModel'
const mocks = vi.hoisted(() => ({ nav: vi.fn(), traffic: vi.fn(), profile: vi.fn(), route: vi.fn() }))
vi.mock('../src/core/api', () => ({ apiGet: mocks.nav, readIvaoTraffic: mocks.traffic, readAircraftPerformance: mocks.profile, readRouteGeometry: mocks.route }))
const nav = { ...bundle, airport: bundle.airports.VTCC } as unknown as RegionalNavPayload
beforeEach(() => {
  vi.resetModules()
  mocks.nav.mockResolvedValue(nav)
  mocks.profile.mockResolvedValue({ found: true, profile: { aircraftType: 'B738' } })
  mocks.traffic.mockResolvedValue({ flights: [{ sessionId: 'NOK0409', aircraft: 'B738', departure: 'VTBD', arrival: 'VTCC', onGround: false, route: 'OLVUK1B OLVUK Y26 MARNI MARNI2A' }] })
  mocks.route.mockResolvedValue({ origin: 'VTBD', destination: 'VTCC', cycle: '2609', segments: [], errors: [] })
})
describe('regional route requests', () => {
  it('reuses operational traffic without another request, while still checking the active AIRAC', async () => {
    const { readRegionalSnapshot } = await import('../src/core/regionalPreviewData')
    const traffic = { airport: 'VTCC', fetchedAt: new Date().toISOString(), flights: [] }
    const result = await readRegionalSnapshot(nav, '36', true, traffic)
    expect(result.traffic).toBe(traffic)
    expect(mocks.traffic).not.toHaveBeenCalled()
    expect(mocks.nav).toHaveBeenCalled()
    mocks.nav.mockResolvedValueOnce({ ...nav, cycle: '2610' })
    await expect(readRegionalSnapshot(nav, '36', true, traffic)).rejects.toThrow('Active AIRAC changed')
  })
  it('does not mix airport scopes or preview traffic with operational traffic', async () => {
    const { readRegionalSnapshot } = await import('../src/core/regionalPreviewData')
    const traffic = { airport: 'VTSP', fetchedAt: new Date().toISOString(), flights: [] }
    await expect(readRegionalSnapshot(nav, '36', true, traffic)).rejects.toThrow('scope mismatch')
    await expect(readRegionalSnapshot(nav, '36', false, { ...traffic, airport: 'VTCC' })).rejects.toThrow('scope mismatch')
  })
  it('passes selected arrival runway, active cycle and STAR entry, not an invented departure runway', async () => {
    const { readRegionalSnapshot } = await import('../src/core/regionalPreviewData')
    await readRegionalSnapshot(nav, '36')
    expect(mocks.route).toHaveBeenCalledWith('VTBD', 'VTCC', 'OLVUK1B OLVUK Y26 MARNI MARNI2A', expect.any(AbortSignal),
      { cycle: '2609', arrivalRunway: '36', entryFix: 'MARNI' })
  })
  it('preserves the route-service failure and retries it on the next refresh', async () => {
    mocks.route.mockRejectedValueOnce(new Error('AIRAC mismatch'))
    const { readRegionalSnapshot } = await import('../src/core/regionalPreviewData')
    const first = await readRegionalSnapshot(nav, '36')
    expect(first.routes.NOK0409).toBeNull()
    expect(first.routeErrors?.NOK0409).toBe('AIRAC mismatch')
    const second = await readRegionalSnapshot(nav, '36')
    expect(second.routes.NOK0409).not.toBeNull()
    expect(second.routeErrors?.NOK0409).toBeUndefined()
  })
})
