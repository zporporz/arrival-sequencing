import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VTBD_RUNWAY_GROUPS, vtbdModesForFlow, vtbdFlowFromWorkspace } from '../shared/vtbdRunways'
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry'
import { evaluateFinalTenNm } from '../src/finalTenNmRuntime'
import { installEtaFfLifecycleRuntime } from '../src/etaFfLifecycleRuntime'
import { installSharedAmanRuntime } from '../src/sharedAmanRuntime'
import { installMonitoredTimelineRuntime } from '../src/monitoredTimelineRuntime'
import { installManualSequenceReorderRuntime } from '../src/manualSequenceReorderRuntime'
import * as sequencing from '../src/core/arrivalSequencing'
import type { OperationalConfigPayload } from '../src/core/api'

const fixture = vi.hoisted(() => ({ eta: '', fix: 'WEHHA' }))
vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Test', vid: 'TEST' }) }))
vi.mock('../src/core/arrivalEta', () => ({ estimateIawpArrival: () => ({ predictedIawpAt: fixture.eta, source: 'TEST', reason: null }) }))
vi.mock('../src/core/api', async original => ({ ...await original<object>(),
  readOperationalConfig: async () => ({ workspaces: [] }),
  readAircraftPerformance: async () => ({ profile: null }),
  readIvaoTraffic: async (airport: string) => ({ airport, fetchedAt: new Date().toISOString(), flights: [{
    sessionId: airport, callsign: airport === 'VTBD' ? 'AIQ123' : 'THA123', aircraft: 'A320', wakeTurbulence: 'M', arrival: airport, departure: '',
    route: airport === 'VTBD' ? fixture.fix : 'TUMGA', onGround: false, state: 'en route', latitude: 14, longitude: 101,
  }] }),
}))
import App, { currentSharedAutoReturnOverrides, defaultArrivalRunway, masterTimingLookup, nominalStarSeconds, resetAirportSpacing } from '../src/AppMaestroV24'

describe('VTBD 03 timing and runway isolation', () => {
  it.each([['ENDUU', 26, 17], ['NAKON', 22.5, 13], ['SABAI', 15, 20], ['SEHNA', 20, 25], ['WEHHA', 21.5, 13]])('%s uses the selected flow', (fix, north, south) => {
    expect(nominalStarSeconds('VTBD', String(fix), '19_20', '03')).toBe(Number(north) * 60)
    expect(nominalStarSeconds('VTBD', String(fix))).toBe(Number(south) * 60)
  })
  it('never borrows an opposite-flow master or unsupported 21 shortcut timing', () => {
    const south = { workspaces: [{ airport: 'VTBD', flow: '21', timings: [{ fix: 'WEHHA', nominalSeconds: 999 }] }] } as OperationalConfigPayload
    expect(masterTimingLookup(south).VTBD.WEHHA).toBe(999)
    expect(masterTimingLookup(south, '19_20', '03').VTBD).toEqual({})
    const north = { workspaces: [{ airport: 'VTBD', flow: '03', timings: [{ fix: 'WEHHA', nominalSeconds: 1200 }] }] } as OperationalConfigPayload
    expect(masterTimingLookup(north, '19_20', '03').VTBD.WEHHA).toBe(1200)
    expect(masterTimingLookup(north).VTBD).toEqual({})
    expect(nominalStarSeconds('VTBD', 'OPERA', '19_20', '03')).toBeNull()
    expect(nominalStarSeconds('VTBS', 'TUMGA', '19_20', '03')).toBe(1200)
  })
  it('closes the reciprocal ends, infers legacy CUSTOM, and preserves callsign allocation', () => {
    expect(vtbdModesForFlow({ '03L': 'ARR', '03R': 'DEP', '21R': 'ARR' }, '03')).toEqual({
      '03L': 'ARR', '03R': 'DEP', '21R': 'CLOSED', '21L': 'CLOSED',
    })
    expect(vtbdFlowFromWorkspace({ '03L': 'CLOSED', '03R': 'CLOSED' })).toBe('03')
    expect(vtbdFlowFromWorkspace({ '21R': 'ARR', '21L': 'ARR' })).toBe('21')
    expect(defaultArrivalRunway('VTBD', ['03R', '03L'], 'AIQ123')).toBe('03L')
    expect(defaultArrivalRunway('VTBD', ['03L', '03R'], 'RTAF123')).toBe('03R')
    expect(defaultArrivalRunway('VTBD', ['03R'], 'AIQ123')).toBe('03R')
    expect(defaultArrivalRunway('VTBD', ['21R', '21L'], 'RTAF123')).toBe('21L')
  })
  it('resets only the displayed direction LAND SEP', () => {
    expect(resetAirportSpacing({ 'VTBD:21R': 9, 'VTBD:03L': 10, 'VTBD:03R': 10, 'VTBS:19': 7 }, 'VTBD', '19_20', '03')).toEqual({
      'VTBD:21R': 9, 'VTBD:03L': 5, 'VTBD:03R': 7.1, 'VTBS:19': 7,
    })
  })
  it('ignores 21 Frozen/AUTO-return targets when the selected flow is 03', () => {
    const now = Date.now(), eta = new Date(now + 600000).toISOString(), p = [{ id: 'VTBD:north', callsign: 'AIQ123' }]
    const state = { airport: 'VTBD', callsign: 'AIQ123', target_mode: 'AUTO' as const, frozen_runway: '21R', frozen_tldt: eta,
      auto_return_runway: '21L', auto_return_tldt: eta, auto_return_floor_tldt: eta, auto_returned_at: new Date(now).toISOString() }
    expect(currentSharedAutoReturnOverrides(p, [state], now, '19_20', '03')).toEqual({ tldtById: {}, floorById: {}, runwayById: {} })
    expect(currentSharedAutoReturnOverrides(p, [{ ...state, frozen_runway: '03L' }], now, '19_20', '03').runwayById['VTBD:north']).toBe('03L')
    expect(currentSharedAutoReturnOverrides(p, [{ ...state, target_mode: 'MANUAL', manual_runway: '21R', frozen_runway: '03L' }], now, '19_20', '03').tldtById['VTBD:north']).toBe(eta)
    expect(currentSharedAutoReturnOverrides(p, [{ ...state, target_mode: 'MANUAL', manual_runway: '03R', frozen_runway: '03L' }], now, '19_20', '03').tldtById).toEqual({})
  })
  it.each(VTBD_RUNWAY_GROUPS['03'])('%s Final uses the correct threshold and northbound heading', runway => {
    const g = BANGKOK_FINAL_GEOMETRY[`VTBD:${runway}`], rad = g.course * Math.PI / 180
    const flight = { callsign: 'AIQ123', latitude: g.lat - Math.cos(rad) * 5 / 60,
      longitude: g.lon - Math.sin(rad) * 5 / (60 * Math.cos(g.lat * Math.PI / 180)),
      heading: g.course, onGround: false, trackTimestamp: new Date().toISOString() }
    expect(evaluateFinalTenNm('VTBD', runway, flight)).toMatchObject({ final: true, available: true })
    expect(evaluateFinalTenNm('VTBD', runway, { ...flight, heading: g.course + 180 }).final).toBe(false)
    expect(evaluateFinalTenNm('VTBD', runway, { ...flight, onGround: true }).final).toBe(false)
  })
})

describe('VTBD 03 live AMAN and shared workspace', () => {
  let root: Root, container: HTMLDivElement, dispose: (() => void) | undefined
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    fixture.eta = new Date(Date.now() + 45 * 60_000).toISOString(); fixture.fix = 'WEHHA'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ serviceDate: new Date().toISOString().slice(0, 10), workspaceStates: [], flightStates: [], sequenceOrders: [] })))
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { dispose?.(); dispose = undefined; await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const cards = () => [...container.querySelectorAll('[data-airport="VTBD"] .aman-runway-card > b')].map(el => el.textContent)
  const arrival = (airport = 'VTBD') => container.querySelector<HTMLElement>(`.aman-flight-row[data-airport="${airport}"]`)!
  async function profile(value: string) {
    await act(async () => { const select = container.querySelector<HTMLSelectElement>('[aria-label="VTBD configuration"]')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  it('defaults to 21 and switches 03 / 21 timing immediately without changing FF or BS', async () => {
    await act(async () => root.render(<App />))
    expect(cards()).toEqual(['21R', '21L'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(13 * 60_000)
    const bsTldt = arrival('VTBS').dataset.autoBaselineTldt
    await profile('DUAL_03LARR_03RARR')
    expect(cards()).toEqual(['03L', '03R'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(21.5 * 60_000)
    expect(arrival().dataset.autoBaselineRunway).toBe('03L')
    expect(arrival('VTBS').dataset.autoBaselineTldt).toBe(bsTldt)
    expect(container.textContent).toContain('DOTLI · TIMING EST')
    await profile('DUAL_21RARR_21LARR')
    expect(cards()).toEqual(['21R', '21L'])
    expect(Date.parse(arrival().dataset.autoBaselineTldt!) - Date.parse(fixture.eta)).toBe(13 * 60_000)
  })
  it('hydrates CUSTOM 03 for a late joiner, discarding an old 21 manual target without echo writes', async () => {
    const state = { airport: 'VTBD', service_date: new Date().toISOString().slice(0, 10), profile_id: 'CUSTOM',
      runway_modes: vtbdModesForFlow({ '03L': 'ARR', '03R': 'ARR' }, '03'),
      spacing_nm: { '03L': 6, '03R': 8 }, settings: { runwayFlow: '03' }, revision: 2 }
    const oldFlight = { airport: 'VTBD', callsign: 'AIQ123', target_mode: 'MANUAL', manual_runway: '21R', manual_tldt: new Date(Date.now() + 5 * 60000).toISOString(), revision: 3 }
    vi.mocked(fetch).mockImplementation(async () => Response.json({ serviceDate: state.service_date, workspaceStates: [state], flightStates: [oldFlight], sequenceOrders: [] }))
    await act(async () => root.render(<App />))
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 50)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
    expect(cards()).toEqual(['03L', '03R'])
    expect(container.querySelector<HTMLSelectElement>('[aria-label="VTBD configuration"]')!.value).toBe('CUSTOM')
    expect(container.querySelector<HTMLInputElement>('[aria-label="VTBD 03L LAND SEP"]')!.value).toBe('6')
    expect(arrival().dataset.autoBaselineRunway).toBe('03L')
    expect(arrival().classList.contains('is-stable')).toBe(false)
    expect(arrival().dataset.targetMode).toBe('AUTO')
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
  it('applies the valid shared 03 manual target after hydrating a late joiner from default 21', async () => {
    const state = { airport: 'VTBD', service_date: new Date().toISOString().slice(0, 10), profile_id: 'DUAL_03LARR_03RARR',
      runway_modes: vtbdModesForFlow({ '03L': 'ARR', '03R': 'ARR' }, '03'), spacing_nm: {}, settings: { runwayFlow: '03' }, revision: 2 }
    const manualTldt = new Date(Date.now() + 90 * 60000).toISOString()
    const flight = { airport: 'VTBD', callsign: 'AIQ123', target_mode: 'MANUAL', manual_runway: '03R', manual_tldt: manualTldt, revision: 3 }
    vi.mocked(fetch).mockImplementation(async () => Response.json({ serviceDate: state.service_date, workspaceStates: [state], flightStates: [flight], sequenceOrders: [] }))
    await act(async () => root.render(<App />))
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 50)) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    expect(arrival().querySelector<HTMLSelectElement>('.runway-assignment select')!.value).toBe('03R')
    expect(arrival().classList.contains('is-stable')).toBe(true)
    expect(arrival().dataset.targetMode).toBe('MANUAL')
    expect(arrival().dataset.sharedRunwayFlow).toBe('03')
    const targetPx = Number.parseFloat(arrival().style.getPropertyValue('--offset-px'))
    expect(Math.abs(Date.now() - targetPx / 10 * 60000 - Date.parse(manualTldt))).toBeLessThan(16000)
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
  it('saves 03 CUSTOM/preset settings while retaining saved 21 spacing', async () => {
    const state = { airport: 'VTBD', service_date: new Date().toISOString().slice(0, 10), profile_id: 'CUSTOM',
      runway_modes: vtbdModesForFlow({ '21R': 'ARR', '21L': 'ARR' }, '21'),
      spacing_nm: { '21R': 7, '21L': 9 }, settings: { runwayFlow: '21' }, revision: 3 }
    vi.mocked(fetch).mockImplementation(async (_input, init) => Response.json(init?.method === 'POST' ? {} : {
      serviceDate: state.service_date, workspaceStates: [state], flightStates: [], sequenceOrders: [],
    }))
    await act(async () => root.render(<App />))
    await act(async () => { dispose = installSharedAmanRuntime(); await new Promise(resolve => setTimeout(resolve, 30)) })
    await profile('03LARR_03RDEP')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ airport: 'VTBD', settings: { runwayFlow: '03' },
      runwayModes: { '03L': 'ARR', '03R': 'DEP' }, spacingNm: { '21R': 7, '21L': 9, '03L': 5, '03R': 7.1 } })
  })
  it('clears the 21 Frozen latch while preserving locked FF until 03 Final geometry arrives', async () => {
    const eta = new Date(Date.now() + 10 * 60000).toISOString().slice(11, 19)
    container.innerHTML = `<div class="aman-flight-row" data-final-ten-nm="true" data-final-geometry-available="true" data-final-runway="21R"
      title="VTBD RWY 21R · ETA-FF ${eta}Z · STA/TLDT ${eta}Z"><span></span><strong>AIQ123</strong><span></span><span></span><span></span></div>`
    dispose = installEtaFfLifecycleRuntime()
    const row = container.querySelector<HTMLElement>('.aman-flight-row')!
    expect(row.dataset.flightStatus).toBe('FROZEN')
    row.title = row.title.replace('RWY 21R', 'RWY 03L')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(row.dataset.flightStatus).toBe('STABLE')
    expect(row.dataset.etaFfLocked).toBe('true')
  })
  it('does not latch a 21 fallback order before a 03 shared workspace has rendered', () => {
    const publish = vi.spyOn(sequencing, 'setAmanManualSequenceOrderSnapshot')
    container.innerHTML = ['FIRST', 'SECOND'].map((callsign, i) => `<div class="aman-flight-row" data-runway-flow="21" title="VTBD RWY 21R" style="--offset-px: ${-i * 50}"><strong>${callsign}</strong><em class="runway-assignment">21R</em></div>`).join('')
    dispose = installManualSequenceReorderRuntime()
    const detail = { workspaceStates: [{ airport: 'VTBD', runway_modes: { '03L': 'ARR', '03R': 'ARR' }, settings: { runwayFlow: '03' } }],
      flightStates: [{ airport: 'VTBD', callsign: 'FIRST', target_mode: 'MANUAL', manual_runway: '03L', manual_tldt: new Date(Date.now() + 30 * 60000).toISOString() }] }
    window.dispatchEvent(new CustomEvent('aman:shared-state', { detail }))
    expect(publish).toHaveBeenLastCalledWith({})
    container.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(row => { row.dataset.runwayFlow = '03'; row.title = 'VTBD RWY 03L'; row.querySelector('em')!.textContent = '03L' })
    window.dispatchEvent(new CustomEvent('aman:shared-state', { detail }))
    expect(publish).toHaveBeenLastCalledWith({ 'VTBD:SECOND': 1, 'VTBD:FIRST': 2 })
  })
  it('uses 03 timing for out-of-radius monitored fallback labels', () => {
    const etaMs = Date.now() + 20 * 60000, eta = new Date(etaMs).toISOString().slice(11, 16)
    container.innerHTML = `<div class="aman-runway-config-block" data-airport="VTBD" data-runway-flow="03"></div><div class="aman-flight-layer"></div>
      <div class="aman-inbound-row" data-airport="VTBD" data-planning-state="MONITORED"><span>BD</span><span class="aman-inbound-acid"><strong>TEST</strong></span><span>A320</span><span>ENDUU</span><span>${eta}</span></div>`
    dispose = installMonitoredTimelineRuntime()
    const row = container.querySelector<HTMLElement>('.aman-monitored-flight-row')!
    expect(row.querySelector('.tldt')?.textContent).toBe(new Date(etaMs + 26 * 60000).toISOString().slice(11, 16))
  })
})
