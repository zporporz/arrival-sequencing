import { beforeEach, describe, expect, it } from 'vitest'
import { chooseArrivalStar, supportsArrivalRunway } from '../shared/arrivalStarSelection'
import { applyArrivalStarChoice, clearArrivalStarChoices, rememberArrivalStar } from '../src/core/arrivalStarChoice'
import { resolveRegionalArrival, type RegionalAirport } from '../src/core/regionalArrivalModel'
import { regionalFlightArrival, regionalPrediction } from '../src/core/regionalAmanAdapter'
import { estimateRegionalEntry } from '../src/core/regionalLiveEstimate'
import type { IvaoArrivalTrafficFlight } from '../src/core/api'
import type { RouteGeometry } from '../src/core/arrivalEtaLegacy'
import type { RegionalSnapshot } from '../src/core/regionalPreviewData'
import bundle from '../functions/_data/regional-arrivals.json'

beforeEach(clearArrivalStarChoices)
const candidate = { name: 'SABA1B', airport: 'VTBD', entryFix: 'SABAI', runways: ['03B'] }
const options = { airport: 'VTBD', runway: '03L', entryFix: 'SABAI', filed: 'SABAI3A', cycle: '2609', candidates: [candidate] }
const flight = { sessionId: 'star-plan', departure: 'VTST', arrival: 'VTBD', route: 'HOTEL SABAI3A' }

describe('shared no-guess STAR policy', () => {
  it('requires a concrete runway and correct airport/entry, including parallel sides', () => {
    expect(supportsArrivalRunway('03B', '03L')).toBe(true)
    expect(supportsArrivalRunway('03L', '03R')).toBe(false)
    expect(supportsArrivalRunway('03B', '03B')).toBe(false)
    for (const changed of [{ airport: 'VTBS' }, { runway: '21L' }, { entryFix: 'DOTLI' }]) {
      expect(chooseArrivalStar({ ...options, ...changed }).selected).toBeNull()
    }
  })
  it('labels a single candidate as EST and refuses arbitrary, invalid or multiple choices', () => {
    expect(chooseArrivalStar(options)).toMatchObject({ status: 'ESTIMATED', selected: 'SABA1B', filed: 'SABAI3A' })
    expect(chooseArrivalStar(options).reason).toContain('NOT A CLEARANCE')
    const multiple = { ...options, candidates: [candidate, { ...candidate, name: 'SABA1C' }] }
    expect(chooseArrivalStar(multiple).selected).toBeNull()
    expect(chooseArrivalStar({ ...multiple, selected: 'SABA1C' })).toMatchObject({ status: 'MANUAL_ESTIMATE', selected: 'SABA1C' })
    expect(chooseArrivalStar({ ...multiple, selected: 'BAD1A' }).selected).toBeNull()
  })
  it('invalidates local choices on route, runway, entry, cycle, airport and session changes', () => {
    const selection = chooseArrivalStar({ ...options, candidates: [candidate, { ...candidate, name: 'SABA1C' }] })
    rememberArrivalStar(flight, selection, 'SABA1C')
    expect(applyArrivalStarChoice(flight, selection)).toMatchObject({ status: 'MANUAL_ESTIMATE', selected: 'SABA1C' })
    expect(selection.selected).toBeNull() // cached server response was not mutated
    for (const change of [{ sessionId: 'other' }, { departure: 'VTSP' }, { arrival: 'VTBS' }, { route: 'NEW ROUTE' }]) {
      expect(applyArrivalStarChoice({ ...flight, ...change }, selection)?.selected).toBeNull()
    }
    for (const change of [{ cycle: '2610' }, { airport: 'VTBS' }, { runway: '03R' }, { entryFix: 'DOTLI' }, { candidates: ['SABA1B'] }]) {
      expect(applyArrivalStarChoice(flight, { ...selection, ...change })?.selected).toBeNull()
    }
    rememberArrivalStar(flight, selection, '')
    expect(applyArrivalStarChoice(flight, selection)?.selected).toBeNull()
  })
})

describe('regional runway reversal — all bundled STARs, not name resemblance', () => {
  for (const airport of Object.values(bundle.airports) as unknown as RegionalAirport[]) {
    for (const star of airport.procedures.filter(p => p.kind === 'STAR')) {
      const opposite = airport.runways.find(r => r.name !== star.runway)!.name
      it(`${airport.code} ${star.name}: ${star.runway} to ${opposite}`, () => {
        const result = resolveRegionalArrival(airport, opposite, star.name, undefined, bundle.cycle)
        const compatible = airport.procedures.filter(p => p.kind === 'STAR' && p.runway === opposite && p.legs[0]?.fix === star.legs[0]?.fix && !p.transitions.length)
        expect(result.selection?.filed).toBe(star.name)
        if (compatible.length === 1) {
          expect(result.star?.id).toBe(compatible[0].id)
          expect(result.selection?.status).toBe('ESTIMATED')
        } else { expect(result.star).toBeNull(); expect(result.selection?.status).toBe('REQUIRED') }
        expect(resolveRegionalArrival(airport, star.runway, star.name).star?.id).toBe(star.id)
      })
    }
  }
  it('does not hide an unknown revision or an instruction after the STAR', () => {
    const airport = bundle.airports.VTCC as unknown as RegionalAirport
    for (const route of ['MARNI MARNI9Z', 'MARNI2A UNKNOWN', 'MARNI2A MARNI2B']) {
      expect(resolveRegionalArrival(airport, '18', route).star).toBeNull()
    }
  })
  it('requires a local choice when several variants enter at the same fix', () => {
    const original = bundle.airports.VTCC as unknown as RegionalAirport
    const old = original.procedures.find(p => p.kind === 'STAR' && p.runway === '36')!
    const a = { ...old, id: 'candidate-a', name: 'CAND1A', runway: '18', transitions: [] }
    const b = { ...a, id: 'candidate-b', name: 'CAND1B' }
    const airport = { ...original, procedures: [old, a, b] }, f = { ...flight, arrival: 'VTCC', route: old.name } as IvaoArrivalTrafficFlight
    const nav = { airport, cycle: bundle.cycle, source: bundle.source }
    const result = regionalFlightArrival(nav, '18', f)
    expect(result.star).toBeNull()
    expect(result.selection?.candidates).toEqual(['CAND1A', 'CAND1B'])
    rememberArrivalStar(f, result.selection!, 'CAND1B')
    expect(regionalFlightArrival(nav, '18', f).star?.id).toBe('candidate-b')
    expect(regionalFlightArrival({ ...nav, cycle: '2610' }, '18', f).star).toBeNull()
    expect(f.route).toBe(old.name)
  })
})

describe('independent regional entry ETA', () => {
  const now = '2026-09-15T13:00:00Z'
  const geometry: RouteGeometry = { origin: 'VTBD', destination: 'VTCC', cycle: '2609', errors: [], totalDistance: 60,
    segments: [{ from: { identifier: 'START', type: 'FIX', coordinates: { lat: 17, lon: 100 } },
      to: { identifier: 'ENTRY', type: 'FIX', coordinates: { lat: 18, lon: 100 } }, distance: 60, bearing: 0, cumulativeDistance: 60 }] }
  const f = { ...flight, departure: 'VTBD', arrival: 'VTCC', state: 'En Route', onGround: false, latitude: 17.5,
    longitude: 100, heading: 0, groundSpeed: 300, trackTimestamp: now } as IvaoArrivalTrafficFlight
  it('updates ETA to the entry without inventing a STAR or landing time', () => {
    const eta = estimateRegionalEntry(f, geometry, 'ENTRY', now)
    expect(eta).toBeGreaterThan(Date.parse(now))
    expect(estimateRegionalEntry({ ...f, latitude: 17.6, trackTimestamp: '2026-09-15T13:00:15Z' }, geometry, 'ENTRY', '2026-09-15T13:00:15Z')).toBeLessThan(eta!)
    expect(estimateRegionalEntry(f, geometry, 'ENTRY', '2026-09-15T13:00:30Z')).toBe(eta)
  })
  it('rejects ground, stale, off-route, wrong-direction, wrong-entry and invalid geometry', () => {
    for (const change of [{ onGround: true }, { latitude: 20 }, { longitude: 101 }, { heading: 180 }, { groundSpeed: 0 }, { trackTimestamp: '2026-09-15T12:55:00Z' }]) {
      expect(estimateRegionalEntry({ ...f, ...change }, geometry, 'ENTRY', now)).toBeNull()
    }
    expect(estimateRegionalEntry(f, geometry, 'OTHER', now)).toBeNull()
    expect(estimateRegionalEntry(f, { ...geometry, errors: [{ type: 'airway', message: 'Missing airway' }] }, 'ENTRY', now)).toBeNull()
    expect(estimateRegionalEntry(f, { ...geometry, destination: 'VTSP' }, 'ENTRY', now)).toBeNull()
    expect(estimateRegionalEntry(f, { ...geometry, errors: [{ type: 'star', message: 'bad' }],
      entryRoute: { ...geometry, cycle: '2608', entryFix: 'ENTRY' } }, 'ENTRY', now)).toBeNull()
  })
  it('keeps entry-only output out of the regional landing/sequence prediction', () => {
    const original = bundle.airports.VTCC as unknown as RegionalAirport
    const p = original.procedures.find(p => p.kind === 'STAR' && p.runway === '36')!
    const old = { ...p, legs: [{ ...p.legs[0], fix: 'ENTRY', lat: 18, lon: 100 }, ...p.legs.slice(1)] }
    const nav = { airport: { ...original, procedures: [old] }, cycle: bundle.cycle, source: bundle.source }
    const snapshot = { traffic: { airport: 'VTCC', fetchedAt: now, flights: [] }, routes: { [f.sessionId]: geometry }, profiles: {} } as RegionalSnapshot
    const result = regionalPrediction(nav, snapshot, '18', 'R18', { ...f, route: old.name })
    expect(result.prediction).toBeNull()
    expect(result.entryEtaMs).not.toBeNull()
    expect(result.reason).toContain('ENTRY ONLY EST')
    expect(result.selection?.selected).toBeNull()
  })
})
