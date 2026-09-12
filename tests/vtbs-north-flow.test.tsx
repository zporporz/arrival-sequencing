import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VTBS_RUNWAY_GROUPS, vtbsModesForFlow, vtbsFlowFromWorkspace } from '../shared/vtbsRunways'
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry'
import { evaluateFinalTenNm } from '../src/finalTenNmRuntime'
import { installEtaFfLifecycleRuntime } from '../src/etaFfLifecycleRuntime'
import { installSharedAmanRuntime } from '../src/sharedAmanRuntime'
import { installMonitoredTimelineRuntime } from '../src/monitoredTimelineRuntime'
import type { OperationalConfigPayload } from '../src/core/api'

const fixture = vi.hoisted(() => ({ eta: '2026-09-12T16:00:00.000Z' }))
vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Test', vid: 'TEST' }) }))
vi.mock('../src/core/arrivalEta', () => ({ estimateIawpArrival: () => ({ predictedIawpAt: fixture.eta, source: 'TEST', reason: null }) }))
vi.mock('../src/core/api', async original => ({ ...await original<object>(),
  readOperationalConfig: async () => ({ workspaces: [] }),
  readAircraftPerformance: async () => ({ profile: null }),
  readIvaoTraffic: async (airport: string) => ({ airport, fetchedAt: new Date().toISOString(), flights: airport !== 'VTBS' ? [] : [{
    sessionId: 'north', callsign: 'THA123', aircraft: 'A320', wakeTurbulence: 'M', arrival: 'VTBS', departure: '',
    route: 'TUMGA', onGround: false, state: 'en route', latitude: 14, longitude: 101,
  }] }),
}))
import App, { currentSharedAutoReturnOverrides, defaultArrivalRunway, masterTimingLookup, nominalStarSeconds, resetAirportSpacing } from '../src/AppMaestroV24'

describe('VTBS north-flow timing and isolation', () => {
  it.each([['LEBIM', 20, 21], ['TUMGA', 17, 20], ['EASTE', 19, 19], ['WILLA', 24, 21], ['NORTA', 22, 20]])('%s uses the selected flow', (fix, north, south) => {
    expect(nominalStarSeconds('VTBS', String(fix), '01_02')).toBe(Number(north) * 60)
    expect(nominalStarSeconds('VTBS', String(fix), '19_20')).toBe(Number(south) * 60)
  })
  it('does not borrow the sole published timing workspace from the opposite flow', () => {
    const config = { workspaces: [{ airport: 'VTBS', flow: '19_20', timings: [{ fix: 'TUMGA', nominalSeconds: 999 }] }] } as OperationalConfigPayload
    expect(masterTimingLookup(config, '19_20').VTBS.TUMGA).toBe(999)
    expect(masterTimingLookup(config, '01_02').VTBS).toEqual({})
    expect(nominalStarSeconds('VTBD', 'WEHHA', '01_02')).toBe(13 * 60)
  })
  it('closes all reciprocal ends and uses 01 as the default arrival', () => {
    expect(vtbsModesForFlow({ '01': 'MIX', '02L': 'ARR', '02R': 'DEP', '19': 'ARR' }, '01_02')).toEqual({
      '01': 'MIX', '02L': 'ARR', '02R': 'DEP', '19': 'CLOSED', '20L': 'CLOSED', '20R': 'CLOSED',
    })
    expect(defaultArrivalRunway('VTBS', ['02L', '01'], 'THA123')).toBe('01')
    expect(vtbsFlowFromWorkspace({ '01': 'CLOSED', '02L': 'CLOSED', '02R': 'CLOSED' })).toBe('01_02')
    expect(vtbsFlowFromWorkspace({ '19': 'MIX', '20R': 'ARR' })).toBe('19_20')
  })
  it('resets only the selected flow spacing and keeps other airports untouched', () => {
    expect(resetAirportSpacing({ 'VTBS:19': 9, 'VTBS:01': 10, 'VTBS:02L': 10, 'VTBS:02R': 10, 'VTBD:21R': 7 }, 'VTBS', '01_02')).toEqual({
      'VTBS:19': 9, 'VTBS:01': 5.5, 'VTBS:02L': 6, 'VTBS:02R': 8, 'VTBD:21R': 7,
    })
  })
  it('ignores old-flow Frozen and AUTO-return time overrides', () => {
    const now = Date.now(), p = [{ id: 'VTBS:north', callsign: 'THA123' }]
    const state = { airport: 'VTBS', callsign: 'THA123', target_mode: 'AUTO' as const, frozen_runway: '19', frozen_tldt: fixture.eta,
      auto_return_runway: '20R', auto_return_tldt: fixture.eta, auto_return_floor_tldt: fixture.eta, auto_returned_at: new Date(now).toISOString() }
    expect(currentSharedAutoReturnOverrides(p, [state], now, '01_02')).toEqual({ tldtById: {}, floorById: {}, runwayById: {} })
    expect(currentSharedAutoReturnOverrides(p, [{ ...state, frozen_runway: '01' }], now, '01_02').runwayById['VTBS:north']).toBe('01')
  })
  it.each(VTBS_RUNWAY_GROUPS['01_02'])('%s final uses its own threshold and northbound heading', runway => {
    const g = BANGKOK_FINAL_GEOMETRY[`VTBS:${runway}`], rad = g.course * Math.PI / 180
    const flight = { callsign: 'THA123', latitude: g.lat - Math.cos(rad) * 5 / 60,
      longitude: g.lon - Math.sin(rad) * 5 / (60 * Math.cos(g.lat * Math.PI / 180)),
      heading: g.course, onGround: false, trackTimestamp: new Date().toISOString() }
    expect(evaluateFinalTenNm('VTBS', runway, flight)).toMatchObject({ final: true, available: true })
    expect(evaluateFinalTenNm('VTBS', runway, { ...flight, heading: g.course + 180 }).final).toBe(false)
    expect(evaluateFinalTenNm('VTBS', runway, { ...flight, onGround: true }).final).toBe(false)
  })
})

describe('VTBS flow controls and late join', () => {
  let root: Root, container: HTMLDivElement, dispose: (() => void) | undefined
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    fixture.eta = new Date(Date.now() + 45 * 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ serviceDate: new Date().toISOString().slice(0, 10), workspaceStates: [], flightStates: [], sequenceOrders: [] })))
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { dispose?.(); dispose = undefined; await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const cards = () => [...container.querySelectorAll('[data-airport="VTBS"] .aman-runway-card > b')].map(el => el.textContent)
  const arrival = () => container.querySelector<HTMLElement>('.aman-flight-row[data-airport="VTBS"]')!
  async function profile(value: string) {
    await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="VTBS configuration"]')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  it('defaults south, switches to three north cards and recalculates TLDT from the same FF', async () => {
    await act(async () => root.render(<App />))
    expect(cards()).toEqual(['19', '20L', '20R'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(20 * 60_000)
    await profile('SEMI35_01MIX_02RDEP_02LARR')
    expect(cards()).toEqual(['01', '02L', '02R'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(17 * 60_000)
    expect(arrival().dataset.autoBaselineRunway).toBe('01')
    expect([...container.querySelectorAll('[data-airport="VTBD"] .aman-runway-card > b')].map(el => el.textContent)).toEqual(['21R', '21L'])
    await profile('SEMI35_19MIX_20LDEP_20RARR')
    expect(cards()).toEqual(['19', '20L', '20R'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(20 * 60_000)
  })
  it('hydrates a CUSTOM north-flow workspace on a fresh browser without an echo write', async () => {
    const state = { airport: 'VTBS', service_date: new Date().toISOString().slice(0, 10), profile_id: 'CUSTOM',
      runway_modes: vtbsModesForFlow({ '01': 'DEP', '02L': 'ARR', '02R': 'ARR' }, '01_02'),
      spacing_nm: { '01': 5.5, '02L': 7.5, '02R': 8 }, settings: { runwayFlow: '01_02' }, revision: 2 }
    vi.mocked(fetch).mockResolvedValue(Response.json({ serviceDate: state.service_date, workspaceStates: [state], flightStates: [], sequenceOrders: [] }))
    await act(async () => { root.render(<App />) })
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(cards()).toEqual(['01', '02L', '02R'])
    expect(container.querySelector<HTMLSelectElement>('[aria-label="VTBS configuration"]')!.value).toBe('CUSTOM')
    expect(container.querySelector<HTMLInputElement>('[aria-label="VTBS 02L LAND SEP"]')!.value).toBe('7.5')
    expect(arrival().dataset.autoBaselineRunway).toBe('02L')
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
  it('includes the selected north flow in the shared workspace save', async () => {
    await act(async () => root.render(<App />))
    await profile('SEMI35_01MIX_02RDEP_02LARR')
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 10)) })
    await act(async () => { window.dispatchEvent(new CustomEvent('aman:workspace-config-change', { detail: { airport: 'VTBS' } })); await new Promise(resolve => setTimeout(resolve, 400)) })
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ airport: 'VTBS', settings: { runwayFlow: '01_02' },
      runwayModes: { '01': 'MIX', '02L': 'ARR', '02R': 'DEP' }, spacingNm: { '01': 5.5, '02L': 6, '02R': 8 } })
  })
  it('keeps saved south-flow LAND SEP when switching to north flow', async () => {
    const state = { airport: 'VTBS', service_date: new Date().toISOString().slice(0, 10), profile_id: 'CUSTOM',
      runway_modes: vtbsModesForFlow({ '19': 'MIX', '20L': 'DEP', '20R': 'ARR' }, '19_20'),
      spacing_nm: { '19': 7, '20L': 9, '20R': 8 }, settings: { runwayFlow: '19_20' }, revision: 3 }
    vi.mocked(fetch).mockImplementation(async (_input, init) => Response.json(init?.method === 'POST' ? {} : {
      serviceDate: state.service_date, workspaceStates: [state], flightStates: [], sequenceOrders: [],
    }))
    await act(async () => root.render(<App />))
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 30)) })
    await profile('SEMI35_01MIX_02RDEP_02LARR')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ settings: { runwayFlow: '01_02' },
      spacingNm: { '19': 7, '20L': 9, '20R': 8, '01': 5.5, '02L': 6, '02R': 8 } })
  })
  it('does not retain a south-flow Frozen latch or request with stale final geometry', async () => {
    const eta = new Date(Date.now() + 10 * 60_000).toISOString().slice(11, 19)
    container.innerHTML = `<div class="aman-flight-row" data-final-ten-nm="true" data-final-geometry-available="true" data-final-runway="19"
      title="VTBS RWY 19 · ETA-FF ${eta}Z · STA/TLDT ${eta}Z"><span></span><strong>THA123</strong><span></span><span></span><span></span></div>`
    dispose = installEtaFfLifecycleRuntime()
    const row = container.querySelector<HTMLElement>('.aman-flight-row')!
    expect(row.dataset.flightStatus).toBe('FROZEN')
    row.title = row.title.replace('RWY 19', 'RWY 01')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(row.dataset.flightStatus).toBe('STABLE')
    expect(row.dataset.etaFfLocked).toBe('true')
  })
  it('uses north timing for monitored fallback labels too', () => {
    const eta = new Date(Date.now() + 20 * 60_000).toISOString().slice(11, 16)
    container.innerHTML = `<div class="aman-runway-config-block" data-airport="VTBS" data-runway-flow="01_02"></div>
      <div class="aman-flight-layer"></div>
      <div class="aman-inbound-row" data-airport="VTBS" data-planning-state="MONITORED"><span>BS</span><span class="aman-inbound-acid"><strong>TEST</strong></span><span>A320</span><span>TUMGA</span><span>${eta}</span></div>`
    dispose = installMonitoredTimelineRuntime()
    const row = container.querySelector<HTMLElement>('.aman-monitored-flight-row')
    expect(row).not.toBeNull()
    const expected = new Date(Date.now() + 37 * 60_000).toISOString().slice(11, 16)
    expect(row!.querySelector('.tldt')?.textContent).toBe(expected)
  })
})
