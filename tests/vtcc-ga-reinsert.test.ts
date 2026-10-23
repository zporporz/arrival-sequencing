import { describe, expect, it } from 'vitest'
import navdata from '../functions/_data/regional-arrivals.json'
import { regionalPrediction, retainRegionalLock } from '../src/core/regionalAmanAdapter'
import type { RegionalNavPayload } from '../src/core/regionalArrivalModel'
import type { IvaoArrivalTrafficFlight } from '../src/core/api'
import type { RegionalSnapshot } from '../src/core/regionalPreviewData'

const nav = { cycle: '2610', source: 'fixture', airport: navdata.airports.VTCC } as RegionalNavPayload
const now = '2026-10-23T10:00:00Z'
const target = '2026-10-23T10:10:00Z'
const flight = { sessionId: 'GA-session', callsign: 'GA123', aircraft: 'A320', arrival: 'VTCC',
  departure: 'VTBD', route: null, onGround: false, state: 'initial climb', latitude: 18.8,
  longitude: 98.95, heading: 270, actualDepartureTimeSeconds: null,
  missedApproachActive: true, targetMode: 'MANUAL', manualRunway: '36', manualTldt: target,
  missedApproachDetectedAt: now, missedApproachExpiresAt: '2026-10-23T10:45:00Z',
} as IvaoArrivalTrafficFlight
const snapshot = { traffic: { airport: 'VTCC', fetchedAt: now, flights: [flight] }, profiles: {}, routes: {} } as RegionalSnapshot
describe('VTCC GA shared-target reinsert', () => {
  it('creates a landing-target row without STAR/approach/profile or matching heading', () => {
    const value = regionalPrediction(nav, snapshot, '36', 'missing', flight)
    expect(value.prediction).toMatchObject({ refFix: 'GA', nominalStarSeconds: 0, regional: {
      landingTargetOnly: true, estimatedLandingAt: new Date(target).toISOString(), runway: '36',
    } })
    expect(value.entryEtaMs).toBeNull()
  })
  it('keeps a fixed target on refresh and accepts controller resequencing without old locks', () => {
    const first = regionalPrediction(nav, snapshot, '36', '', flight).prediction!
    const later = { ...snapshot, traffic: { ...snapshot.traffic, fetchedAt: '2026-10-23T10:02:00Z' } }
    expect(regionalPrediction(nav, later, '36', '', flight).prediction!.predictedIawpAt).toBe(first.predictedIawpAt)
    const changed = regionalPrediction(nav, later, '36', '', { ...flight, manualTldt: '2026-10-23T10:15:00Z' }).prediction!
    expect(retainRegionalLock(first, changed).predictedIawpAt).toBe('2026-10-23T10:15:00.000Z')
  })
  it.each([
    { missedApproachActive: false }, { missedApproachExpiresAt: '2026-10-23T09:59:00Z' },
    { targetMode: 'AUTO' as const }, { manualTldt: 'invalid' }, { manualRunway: '18' }, { onGround: true },
  ])('does not create a GA target for invalid/inactive state %j', change => {
    expect(regionalPrediction(nav, snapshot, '36', '', { ...flight, ...change }).prediction).toBeNull()
  })
})
