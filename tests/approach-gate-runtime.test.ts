import { afterEach, describe, expect, it, vi } from 'vitest'
import data from '../functions/_data/final-approaches.json'
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry'
import { installFinalTenNmRuntime, evaluateFinalTenNm } from '../src/finalTenNmRuntime'
import { installEtaFfLifecycleRuntime } from '../src/etaFfLifecycleRuntime'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(f => f()); vi.unstubAllGlobals(); document.body.innerHTML = ''; vi.useRealTimers() })
function makeRow() {
  document.body.innerHTML = `<div class="aman-flight-row" data-performance-category="C"
    title="VTBD RWY 03L · ETA-FF 10:20:00Z · STA/TLDT 10:35:00Z · STA-FF/TTO 10:20:00Z">
    <span>10:35</span><strong>TEST1</strong><span>A320</span><span>F</span><span>10:20</span><b>0</b>
    <span class="runway-assignment"><select><option>03L</option><option>21R</option></select></span></div>`
  return document.querySelector<HTMLElement>('.aman-flight-row')!
}
function snapshot() {
  return { callsign: 'TEST1', latitude: 13.766583335, longitude: 100.565218055, heading: 331.6,
    altitude: 2500, verticalSpeedFpm: -500, onGround: false, trackTimestamp: new Date().toISOString() }
}
function mockFetch(navOk = true) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('final-approaches')
    ? navOk ? Response.json({ cycle: data.cycle, airport: data.airports.VTBD,
      thresholds: { '03L': BANGKOK_FINAL_GEOMETRY['VTBD:03L'] } }) : new Response('', { status: 503 })
    : Response.json({ airport: 'VTBD', flights: [snapshot()] })))
}

describe('approach capture in the live DOM/lifecycle', () => {
  it('freezes a turning arrival, dispatches the path mode, and retains the existing FF lock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-12T10:00:00Z')
    const row = makeRow(), listener = vi.fn()
    mockFetch()
    window.addEventListener('aman:frozen-target-request', listener)
    cleanups.push(() => window.removeEventListener('aman:frozen-target-request', listener))
    cleanups.push(installFinalTenNmRuntime())
    await vi.waitFor(() => expect(row.dataset.finalPathName).toContain('DOTLI'))
    cleanups.push(installEtaFfLifecycleRuntime())
    expect(row.dataset.flightStatus).toBe('FROZEN')
    expect(row.dataset.etaFfDisplay).toBe('10:20')
    expect(listener.mock.calls[0][0].detail).toMatchObject({ approachPath: true, approachCycle: '2609', airport: 'VTBD', runway: '03L' })
    expect(listener.mock.calls[0][0].detail.distanceNm).toBeCloseTo(8.03, 2)
    const turning = { ...snapshot(), latitude: 14.07, longitude: 100.6946, heading: 165, altitude: 2700 }
    expect(evaluateFinalTenNm('VTBD', '21R', turning).final).toBe(true)
  })
  it('keeps the original aligned gate when approach data is unavailable; no radius-only fallback', async () => {
    const row = makeRow(); mockFetch(false); cleanups.push(installFinalTenNmRuntime())
    await vi.waitFor(() => expect(row.dataset.finalGeometryAvailable).toBe('true'))
    expect(row.dataset.finalTenNm).toBe('false')
    expect(row.dataset.finalPathName).toBeUndefined()
    expect(evaluateFinalTenNm('VTBD', '03L', { ...snapshot(), latitude: 13.85, longitude: 100.572, heading: 29 }).final).toBe(true)
  })
  it('uses a same-runway shared capture on a late browser, without requiring a new crossing', () => {
    const row = makeRow()
    row.dataset.frozenTldt = new Date().toISOString()
    row.dataset.finalGeometryAvailable = 'true'; row.dataset.finalTenNm = 'false'
    cleanups.push(installEtaFfLifecycleRuntime())
    expect(row.dataset.flightStatus).toBe('FROZEN')
  })
  it('clears the Frozen latch on GA and on reassignment, keeping the locked FF', async () => {
    const row = makeRow()
    row.dataset.frozenTldt = new Date().toISOString()
    cleanups.push(installEtaFfLifecycleRuntime())
    expect(row.dataset.flightStatus).toBe('FROZEN')
    delete row.dataset.frozenTldt
    row.dataset.missedApproachActive = 'true'
    await vi.waitFor(() => expect(row.dataset.flightStatus).not.toBe('FROZEN'))
    row.dataset.missedApproachActive = 'false'
    row.querySelector('select')!.value = '21R'; row.dataset.finalRunway = '03L'
    await vi.waitFor(() => expect(row.dataset.flightStatus).not.toBe('FROZEN'))
    expect(row.dataset.etaFfLocked).toBe('true')
  })
});
