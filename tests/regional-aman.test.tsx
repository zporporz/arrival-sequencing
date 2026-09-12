import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import bundle from '../functions/_data/regional-arrivals.json'
import { calculateRegionalTiming, type RegionalAirport } from '../src/core/regionalArrivalModel'
import { regionalPrediction, retainRegionalLock } from '../src/core/regionalAmanAdapter'
import { DEFAULT_AIRPORT_VIEW, changeAirportView, displaySidesFromDom } from '../src/core/airports'
import { autoSequenceUnstableArrivals } from '../src/core/arrivalSequencing'
import type { AircraftPerformanceProfile, IvaoArrivalTrafficFlight } from '../src/core/api'
import type { RegionalSnapshot } from '../src/core/regionalPreviewData'
import { registerRegionalFinalGeometry, evaluateFinalTenNm } from '../src/finalTenNmRuntime'
const mocks = vi.hoisted(() => ({ nav: vi.fn(), snapshot: vi.fn(), traffic: vi.fn() }))
vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Local test', vid: 'LOCAL' }) }))
vi.mock('../src/core/regionalPreviewData', () => ({ readRegionalNav: mocks.nav, readRegionalSnapshot: mocks.snapshot }))
vi.mock('../src/core/api', async importOriginal => ({ ...await importOriginal<object>(), readIvaoTraffic: mocks.traffic,
  readOperationalConfig: async () => ({ workspaces: [], timings: [], fetchedAt: new Date().toISOString() }) }))
import App, { configuredAirportCapacityPerHour } from '../src/AppMaestroV24'
const profile = { source: 'SIMBRIEF', aircraftType: 'A320', performanceCategory: 'C', descentProfile: '78/280/250', descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 } as AircraftPerformanceProfile
function fixture(code: 'VTCC' | 'VTSP', runway = code === 'VTCC' ? '18' : '27') {
  const airport = bundle.airports[code] as unknown as RegionalAirport
  const star = airport.procedures.find(p => p.kind === 'STAR' && p.runway === runway)!
  const approach = airport.procedures.find(p => p.name === (runway === '18' ? 'R18' : runway === '36' ? 'I36-Z' : 'I27'))!
  const timing = calculateRegionalTiming(airport, star, approach, profile).timing!
  const s = timing.segments[0], now = new Date().toISOString()
  const flight = { sessionId: 'test-' + code, callsign: code + '123', aircraft: 'A320', arrival: code, departure: 'VTBD',
    isDomesticThailand: true, route: star.name, state: 'en route', onGround: false, groundSpeed: 250,
    latitude: (s.from.lat! + s.to.lat!) / 2, longitude: (s.from.lon! + s.to.lon!) / 2,
    altitude: (s.startAltitudeFt + s.endAltitudeFt) / 2,
    heading: (Math.atan2((s.to.lon! - s.from.lon!) * Math.cos(s.from.lat! * Math.PI / 180), s.to.lat! - s.from.lat!) * 180 / Math.PI + 360) % 360,
    trackTimestamp: now } as IvaoArrivalTrafficFlight
  const nav = { cycle: bundle.cycle, source: bundle.source, airport }
  const snapshot = { traffic: { airport: code, fetchedAt: now, flights: [flight] }, profiles: { A320: profile }, routes: {} } as RegionalSnapshot
  return { nav, snapshot, flight, runway, approach, timing }
}

describe('regional operational adapter', () => {
  it('keeps BD capacity a single stream while CC/SP use their own selected runway', () => {
    const modes = { VTBD: { '21R': 'ARR', '21L': 'ARR' }, VTBS: { '19': 'ARR' }, VTCC: { '18': 'ARR', '36': 'CLOSED' }, VTSP: { '09': 'CLOSED', '27': 'ARR' } } as const
    expect(configuredAirportCapacityPerHour('VTBD', modes, { 'VTBD:21R': 5, 'VTBD:21L': 7.1 })).toBe(28)
    expect(configuredAirportCapacityPerHour('VTCC', modes, { 'VTCC:18': 5 })).toBe(28)
    expect(configuredAirportCapacityPerHour('VTSP', modes, { 'VTSP:27': 7 })).toBe(20)
  })
  it.each(['VTCC', 'VTSP'] as const)('%s uses its own route, radius and PASSED marker', code => {
    const f = fixture(code), p = regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, f.flight).prediction!
    expect(p).toBeTruthy(); expect(p.regional?.etaFfPassed).toBe(true)
    expect(p.processingDistanceNm).toBeLessThan(200)
    expect(Date.parse(p.predictedIawpAt) + p.nominalStarSeconds * 1000).toBeCloseTo(Date.parse(p.regional!.estimatedLandingAt), -1)
    expect(p.regional!.modelKey).toContain(f.approach.id)
    expect(regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, { ...f.flight, onGround: true }).prediction).toBeNull()
  })
  it('retains a fresh stable forecast off-route, but never retains ground, stale or different-model estimates', () => {
    const f = fixture('VTCC'), p = regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, f.flight).prediction!
    const offRoute = { ...f.flight, latitude: 18, longitude: 101 }
    expect(regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, offRoute).prediction).toBeNull()
    const held = regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, offRoute, p)
    expect(held.prediction?.predictedIawpAt).toBe(p.predictedIawpAt)
    expect(held.reason).toContain('LOCKED EST')
    expect(regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, { ...offRoute, onGround: true }, p).prediction).toBeNull()
    expect(regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, { ...offRoute, trackTimestamp: new Date(Date.now() - 120000).toISOString() }, p).prediction).toBeNull()
    expect(regionalPrediction({ ...f.nav, cycle: 'NEW' }, f.snapshot, f.runway, f.approach.name, offRoute, p).prediction).toBeNull()
  })
  it('keeps stable AUTO time, resets only for a new model/session and permits manual takeover', () => {
    const f = fixture('VTSP'), p = regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, f.flight).prediction!
    const changed = { ...p, predictedIawpAt: new Date(Date.parse(p.predictedIawpAt) + 300000).toISOString() }
    expect(retainRegionalLock(p, changed).predictedIawpAt).toBe(p.predictedIawpAt)
    expect(retainRegionalLock(p, { ...changed, regional: { ...p.regional!, modelKey: 'NEW' } }).predictedIawpAt).toBe(changed.predictedIawpAt)
    expect(retainRegionalLock(p, { ...changed, id: 'VTSP:new' }).predictedIawpAt).toBe(changed.predictedIawpAt)
    expect(retainRegionalLock(undefined, { ...p, regional: { ...p.regional!, stage: 'UNSTABLE' } }, true).regional?.stage).toBe('STABLE')
  })
  it('never shares a sequencing stream between airports even if runway labels match', () => {
    const f = fixture('VTSP'), p = regionalPrediction(f.nav, f.snapshot, f.runway, f.approach.name, f.flight).prediction!
    const rows = autoSequenceUnstableArrivals([p, { ...p, id: 'VTCC:other', callsign: 'OTHER' }], { runwaySpacingSeconds: { [p.runway]: 180 } })
    expect(rows[0].tldt).toBe(rows[1].tldt)
  })
  it.each(['VTCC', 'VTSP'] as const)('%s gets Final 10 NM geometry from navdata', code => {
    const f = fixture(code); registerRegionalFinalGeometry(f.nav.airport)
    const r = f.nav.airport.runways.find(r => r.name === f.runway)!
    const course = r.course * Math.PI / 180
    const result = evaluateFinalTenNm(code, r.name, { callsign: 'TEST', latitude: r.lat - 5 / 60 * Math.cos(course),
      longitude: r.lon - 5 / 60 * Math.sin(course) / Math.cos(r.lat * Math.PI / 180), heading: r.course,
      onGround: false, trackTimestamp: new Date().toISOString() })
    expect(result.available).toBe(true); expect(result.final).toBe(true)
  })
})

describe('main AMAN airport selection', () => {
  let root: Root, container: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flightStates: [], sequenceOrders: [], workspaces: [] })))
    mocks.traffic.mockImplementation(async airport => ({ airport, fetchedAt: new Date().toISOString(), flights: [] }))
    mocks.nav.mockImplementation(async code => fixture(code).nav)
    mocks.snapshot.mockImplementation(async (nav, runway) => fixture(nav.airport.code, runway).snapshot)
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
  async function select(side: string, code: string) {
    await act(async () => { const el = container.querySelector<HTMLSelectElement>(`select[aria-label="${side} airport"]`)!; el.value = code; el.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  it('defaults to BS left / BD right and allows CC / SP in readable selectors', async () => {
    await act(async () => root.render(<App />))
    expect([...container.querySelectorAll('.aman-side-select > span')].map(label => label.textContent)).toEqual(['LEFT', 'RIGHT'])
    expect(displaySidesFromDom().VTBS).toBe('LEFT'); expect(displaySidesFromDom().VTBD).toBe('RIGHT')
    expect(container.textContent).toContain('VTCC · Chiang Mai')
    expect(mocks.nav).not.toHaveBeenCalled()
    await select('LEFT', 'VTCC'); await select('RIGHT', 'VTSP')
    expect([...container.querySelectorAll('.aman-runway-config-block')].map(e => (e as HTMLElement).dataset.airport)).toEqual(['VTCC', 'VTSP'])
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({ airport: expect.objectContaining({ code: 'VTCC' }) }), '18', true,
      expect.objectContaining({ airport: 'VTCC', flights: [] }))
    const rows = container.querySelectorAll<HTMLElement>('.aman-flight-row')
    expect(rows).toHaveLength(2)
    expect([...rows].map(r => r.dataset.airport)).toEqual(expect.arrayContaining(['VTCC', 'VTSP']))
    expect([...rows].every(r => r.dataset.timingModel === 'EST')).toBe(true)
    expect(container.querySelector('[aria-label="VTCC approach"]')).not.toBeNull()
  })
  it('swaps duplicate choices, cannot turn off both sides, and removes deselected airport rows', async () => {
    expect(changeAirportView(DEFAULT_AIRPORT_VIEW, 'LEFT', 'VTBD')).toEqual({ LEFT: 'VTBD', RIGHT: 'VTBS' })
    expect(changeAirportView({ LEFT: 'VTCC', RIGHT: '' }, 'LEFT', '')).toEqual({ LEFT: 'VTCC', RIGHT: '' })
    await act(async () => root.render(<App />)); await select('LEFT', 'VTCC')
    expect(container.querySelector('.aman-flight-row[data-airport="VTCC"]')).not.toBeNull()
    await select('LEFT', 'VTBS')
    expect(container.querySelector('.aman-flight-row[data-airport="VTCC"]')).toBeNull()
  })
})
