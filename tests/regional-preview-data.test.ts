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
