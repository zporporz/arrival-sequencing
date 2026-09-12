import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateIawpArrival } from '../src/core/arrivalEta'
import { clearAircraftPerformanceCategoryCache } from '../src/core/aircraftPerformanceCategory'
import { installSharedAmanRuntime } from '../src/sharedAmanRuntime'

vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Local test', vid: 'LOCAL' }) }))
vi.mock('../src/core/arrivalEta', () => ({ estimateIawpArrival: vi.fn(() => ({
  predictedIawpAt: new Date(Date.now() + 3_600_000).toISOString(), source: 'TEST', reason: null,
})) }))
vi.mock('../src/core/api', async original => ({ ...await original<object>(), readRouteGeometry: async () => null }))
import App from '../src/AppMaestroV24'

let root: Root, container: HTMLDivElement
let nominal: number, failConfig: boolean, removeTimings: boolean, failProfiles: boolean
let sharedWorkspace: Record<string, unknown> | null
const requests: URL[] = [], cleanups: (() => void)[] = []
const types = ['A320', 'A320', 'B738', 'A20N', 'A320', 'B738', 'A20N', 'A320', 'B738', 'A320']
const count = (endpoint: string) => requests.filter(url => url.pathname.endsWith(`/${endpoint}`)).length
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const refreshConfig = async () => { await act(async () => { window.dispatchEvent(new CustomEvent('aman:force-shared-refresh')) }) }
const mount = async () => {
  await act(async () => root.render(<App />))
  requests.length = 0; vi.mocked(estimateIawpArrival).mockClear()
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-13T01:00:00Z')
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  nominal = 780; failConfig = false; removeTimings = false; failProfiles = false; sharedWorkspace = null
  clearAircraftPerformanceCategoryCache()
  requests.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error(`Unexpected write: ${input}`)
    const url = new URL(input, 'https://example.test'); requests.push(url)
    const airport = url.searchParams.get('airport')
    if (url.pathname.endsWith('/operational-config')) {
      if (failConfig) return Response.json({ error: 'Config unavailable' }, { status: 503 })
      return Response.json({ serviceDate: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(),
        workspaces: [{ airport: 'VTBD', airportName: 'Don Mueang', flow: '21', label: 'South',
          timings: removeTimings ? [] : [{ airport: 'VTBD', flow: '21', fix: 'SEHNA', nominalSeconds: nominal,
            source: 'MASTER', verified: true, effectiveFrom: '2026-09-01', effectiveTo: null, updatedAt: null }],
        }],
      })
    }
    if (url.pathname.endsWith('/ivao-traffic')) return Response.json({ airport, fetchedAt: new Date().toISOString(),
      flights: airport === 'VTBD' ? types.map((aircraft, i) => ({ aircraft, sessionId: String(i), callsign: `DMK${i}`,
        arrival: airport, route: 'SEHNA', onGround: false, state: 'en route',
        latitude: 15, longitude: 100, heading: 180, groundSpeed: 250, altitude: 12000,
      })) : [],
    })
    if (url.pathname.endsWith('/aircraft-performance')) {
      if (failProfiles) return Response.json({ error: 'Profile unavailable' }, { status: 503 })
      const type = url.searchParams.get('type')!
      return Response.json({ type, found: true, profile: { source: 'SIMBRIEF', aircraftType: type,
        aircraftName: null, aircraftDefaultCruise: null, aircraftSpeed: null, performanceCategory: 'C',
        descentProfile: '.78/300/250', descentMach: 0.78, descentIasKt: 300, descentBelow10000IasKt: 250,
      } })
    }
    if (url.pathname.endsWith('/aman-state')) return Response.json({ serviceDate: new Date().toISOString().slice(0, 10),
      workspaceStates: sharedWorkspace ? [sharedWorkspace, {
        service_date: '2026-09-13', airport: 'VTBS', revision: 1, profile_id: 'CUSTOM',
        runway_modes: { '19': 'MIX', '20L': 'DEP', '20R': 'ARR' },
        spacing_nm: { '19': 5.5, '20L': 8, '20R': 6 }, settings: { runwayFlow: '19_20' },
      }] : [], flightStates: [], sequenceOrders: [],
    })
    throw new Error(`Unexpected request: ${input}`)
  }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { cleanups.splice(0).reverse().forEach(stop => stop()); root.unmount() })
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('AMAN calculation request reduction', () => {
  it('keeps 15-second traffic/profile refreshes but does not replay calculations on unchanged 60-second config polls', async () => {
    await mount()
    expect(container.querySelectorAll('.aman-flight-row')).toHaveLength(10)
    await advance(60_000)
    expect(count('operational-config')).toBe(1)
    expect(count('ivao-traffic')).toBe(8)
    expect(count('aircraft-performance')).toBe(12) // 3 types x 4 new snapshots, not 10 flights x 4
    expect(estimateIawpArrival).toHaveBeenCalledTimes(40)
    const profiles = requests.filter(url => url.pathname.endsWith('/aircraft-performance')).map(url => url.searchParams.get('type'))
    for (const type of ['A320', 'B738', 'A20N']) expect(profiles.filter(value => value === type)).toHaveLength(4)
  })

  it('still reads on forced refresh and applies changed/removed timings immediately', async () => {
    await mount(); await advance(1_000)
    await refreshConfig()
    expect(count('operational-config')).toBe(1)
    expect(count('aircraft-performance')).toBe(0)
    expect(estimateIawpArrival).not.toHaveBeenCalled()
    const before = container.querySelector<HTMLElement>('.aman-flight-row')!.dataset.autoBaselineTldt!
    nominal = 900
    await refreshConfig()
    expect(count('operational-config')).toBe(2)
    expect(count('ivao-traffic')).toBe(0) // fresh current-interval snapshot is reused
    expect(count('aircraft-performance')).toBe(3)
    expect(estimateIawpArrival).toHaveBeenCalledTimes(10)
    expect(vi.mocked(estimateIawpArrival).mock.calls.every(args => args[3] === 900)).toBe(true)
    expect(Date.parse(container.querySelector<HTMLElement>('.aman-flight-row')!.dataset.autoBaselineTldt!) - Date.parse(before))
      .toBeGreaterThanOrEqual(120_000)
    removeTimings = true
    await refreshConfig()
    expect(container.querySelectorAll('.aman-flight-row')).toHaveLength(0)
    expect(count('aircraft-performance')).toBe(3)
  })

  it('recovers from config errors without replaying unchanged data or delaying traffic', async () => {
    await mount(); failConfig = true
    await refreshConfig()
    expect(count('operational-config')).toBe(1)
    expect(count('aircraft-performance')).toBe(0)
    await advance(15_000)
    expect(count('ivao-traffic')).toBe(2)
    expect(count('aircraft-performance')).toBe(3)
    failConfig = false
    await refreshConfig()
    expect(count('operational-config')).toBe(2)
    expect(count('aircraft-performance')).toBe(3)
    expect(container.querySelectorAll('.aman-flight-row')).toHaveLength(10)
  })

  it('retries failed profiles on the next snapshot and keeps scoped Recompute fresh', async () => {
    await mount(); failProfiles = true
    await advance(15_000)
    // 3 batch reads plus the existing cold category-fallback lookup (3 types).
    // That independent fallback is deliberately unchanged by this optimization.
    expect(count('aircraft-performance')).toBe(6)
    expect(estimateIawpArrival).toHaveBeenCalledTimes(10)
    expect(vi.mocked(estimateIawpArrival).mock.calls.every(args => args[5] === null)).toBe(true)
    failProfiles = false
    vi.mocked(estimateIawpArrival).mockClear()
    const finished = vi.fn()
    window.addEventListener('aman:airport-recompute-finished', finished)
    cleanups.push(() => window.removeEventListener('aman:airport-recompute-finished', finished))
    await act(async () => { window.dispatchEvent(new CustomEvent('aman:recompute-airport', { detail: { airport: 'VTBD' } })) })
    expect(count('ivao-traffic')).toBe(3) // BD+BS tick, then only BD recompute
    expect(count('aircraft-performance')).toBe(9)
    expect(estimateIawpArrival).toHaveBeenCalledTimes(10)
    expect(vi.mocked(estimateIawpArrival).mock.calls.every(args => args[5]?.performanceCategory === 'C')).toBe(true)
    expect(finished.mock.lastCall![0].detail).toMatchObject({ airport: 'VTBD', ok: true })
  })

  it('still applies a shared VTBD LAND SEP change from 5 to 7 on the normal five-second poll', async () => {
    sharedWorkspace = { service_date: '2026-09-13', airport: 'VTBD', revision: 1,
      profile_id: 'DUAL_21RARR_21LARR', runway_modes: { '21R': 'ARR', '21L': 'ARR', '03L': 'CLOSED', '03R': 'CLOSED' },
      spacing_nm: { '21R': 5, '21L': 7.1 }, settings: { runwayFlow: '21' },
    }
    await mount()
    await act(async () => { cleanups.push(installSharedAmanRuntime()) })
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="VTBD 21R LAND SEP"]')!
    expect(input().value).toBe('5')
    await advance(1_000); await refreshConfig() // unchanged timing config must not swallow SEP updates
    const readsBeforeChange = count('aman-state')
    sharedWorkspace = { ...sharedWorkspace, revision: 2, spacing_nm: { '21R': 7, '21L': 7.1 } }
    await advance(4_000)
    expect(input().value).toBe('7')
    expect(count('aman-state')).toBe(readsBeforeChange + 1)
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
})
