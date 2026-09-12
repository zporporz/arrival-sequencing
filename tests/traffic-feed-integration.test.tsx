import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFinalTenNmRuntime } from '../src/finalTenNmRuntime'
import { installOperationalAdvisoryRuntime } from '../src/operationalAdvisoryRuntime'
import { BANGKOK_FINAL_GEOMETRY } from '../shared/bangkokFinalGeometry'
import { subscribeIvaoTraffic } from '../src/core/ivaoTrafficFeed'

vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Local test', vid: 'LOCAL' }) }))
vi.mock('../src/core/arrivalEta', () => ({ estimateIawpArrival: () => ({
  predictedIawpAt: new Date(Date.now() + 600_000).toISOString(), source: 'TEST', reason: null,
}) }))
vi.mock('../src/core/api', async original => ({ ...await original<object>(),
  readOperationalConfig: async () => ({ workspaces: [] }),
  readAircraftPerformance: async () => ({ profile: null }),
  readRouteGeometry: async () => null,
}))
import App from '../src/AppMaestroV24'

let root: Root, container: HTMLDivElement
let failBd = false
const cleanups: (() => void)[] = []
const requests: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-09-13T01:00:00Z')
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  failBd = false; requests.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'https://example.test')
    const airport = url.searchParams.get('airport')!
    if (url.pathname.endsWith('/ivao-traffic')) {
      requests.push(airport)
      if (airport === 'VTBD' && failBd) return Response.json({ error: 'Unavailable' }, { status: 503 })
      const runway = airport === 'VTBD' ? '21R' : '19'
      const g = BANGKOK_FINAL_GEOMETRY[`${airport}:${runway}`], angle = g.course * Math.PI / 180
      return Response.json({ airport, fetchedAt: new Date().toISOString(), flights: [{
        sessionId: airport, callsign: airport === 'VTBD' ? 'DMK1' : 'BKK1', aircraft: 'A320', arrival: airport,
        route: airport === 'VTBD' ? 'SEHNA' : 'TUMGA', onGround: false, state: 'approach',
        latitude: g.lat - Math.cos(angle) * 5 / 60,
        longitude: g.lon - Math.sin(angle) * 5 / (60 * Math.cos(g.lat * Math.PI / 180)),
        heading: g.course, groundSpeed: 200, altitude: 2000, trackTimestamp: new Date().toISOString(),
      }] })
    }
    if (url.pathname.endsWith('/final-approaches')) return new Response('', { status: 503 })
    throw new Error(`Unexpected request: ${input}`)
  }))
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { cleanups.splice(0).reverse().forEach(stop => stop()); root.unmount() })
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('AMAN / Frozen / advisory shared polling', () => {
  it('uses two requests for BD+BS per tick and keeps refreshing Frozen from the shared sample', async () => {
    await act(async () => root.render(<App />))
    await act(async () => {
      cleanups.push(installFinalTenNmRuntime(), installOperationalAdvisoryRuntime())
    })
    expect(requests).toHaveLength(2)
    expect(container.querySelectorAll('.aman-flight-row')).toHaveLength(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    const bd = container.querySelector<HTMLElement>('.aman-flight-row[data-airport="VTBD"]')!
    const bs = container.querySelector<HTMLElement>('.aman-flight-row[data-airport="VTBS"]')!
    expect(bd.dataset.finalTenNm).toBe('true'); expect(bs.dataset.finalTenNm).toBe('true')
    const firstTimestamp = bd.dataset.finalTrackAt
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000) })
    expect(requests).toHaveLength(4)
    expect(bd.dataset.finalTrackAt).not.toBe(firstTimestamp)
    expect(bd.dataset.finalTrackAt).toBe(bs.dataset.finalTrackAt)
    expect(bd.dataset.finalGeometryAvailable).toBe('true')
    const recomputeFinished = vi.fn()
    window.addEventListener('aman:airport-recompute-finished', recomputeFinished)
    cleanups.push(() => window.removeEventListener('aman:airport-recompute-finished', recomputeFinished))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('aman:recompute-airport', { detail: { airport: 'VTBD' } }))
    })
    expect(requests.filter(airport => airport === 'VTBD')).toHaveLength(3)
    expect(requests.filter(airport => airport === 'VTBS')).toHaveLength(2)
    expect(recomputeFinished.mock.lastCall![0].detail).toMatchObject({ airport: 'VTBD', ok: true })
    await act(async () => {
      const right = container.querySelector<HTMLSelectElement>('select[aria-label="RIGHT airport"]')!
      right.value = ''; right.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(requests.filter(airport => airport === 'VTBD')).toHaveLength(3)
    expect(requests.filter(airport => airport === 'VTBS')).toHaveLength(3)
    expect(container.querySelector('.aman-flight-row[data-airport="VTBD"]')).toBeNull()
  })

  it('shares errors without using the old sensor sample and recovers on the next tick', async () => {
    document.body.insertAdjacentHTML('beforeend', `<div class="aman-flight-row" title="VTBD RWY 21R"><strong>DMK1</strong><span class="runway-assignment">BD/21R</span></div>`)
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    const mainConsumer = vi.fn()
    await act(async () => {
      cleanups.push(subscribeIvaoTraffic('VTBD', mainConsumer), installFinalTenNmRuntime(), installOperationalAdvisoryRuntime())
    })
    expect(row.dataset.finalTenNm).toBe('true')
    failBd = true
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(mainConsumer.mock.lastCall![0].payload).toBeNull()
    expect(row.dataset.finalGeometryAvailable).toBe('false')
    expect(row.dataset.finalTrackAt).toBeUndefined()
    failBd = false
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(row.dataset.finalTenNm).toBe('true')
    expect(requests.filter(airport => airport === 'VTBD')).toHaveLength(3)
    row.remove()
  })
})
