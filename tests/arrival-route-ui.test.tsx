import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearArrivalRouteCache } from '../src/core/arrivalRouteGeometry'

vi.mock('../src/AuthGate', () => ({ useAuthUser: () => ({ name: 'Local test', vid: 'LOCAL' }) }))
vi.mock('../src/core/api', async original => ({ ...await original<object>(),
  readOperationalConfig: async () => ({ workspaces: [] }),
  readAircraftPerformance: async () => ({ profile: null }),
}))
import App from '../src/AppMaestroV24'

let root: Root, container: HTMLDivElement, failRoute: boolean
const routeRequests: Record<string, string>[] = []
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-15T13:00:00Z')
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); clearArrivalRouteCache(); routeRequests.length = 0; failRoute = false
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://example.test')
    if (url.pathname.endsWith('/ivao-traffic')) {
      const airport = url.searchParams.get('airport')
      return Response.json({ airport, fetchedAt: new Date().toISOString(), flights: airport === 'VTBD' ? [{
        sessionId: 'ui-route-test', callsign: 'TLM128', aircraft: 'B738', departure: 'VTST', arrival: 'VTBD',
        route: 'TRN Y99 HOTEL', onGround: false, state: 'en route', latitude: 10.5, longitude: 100,
        altitude: 31000, filedCruiseAltitudeFt: 31000, groundSpeed: 468, heading: 0,
        trackTimestamp: new Date().toISOString(), connectedAt: '2026-09-15T11:37:14Z',
        actualDepartureTimeSeconds: 45620, filedEetSeconds: 4320,
      }] : [] })
    }
    if (url.pathname.endsWith('/route-geometry')) {
      expect(init?.method).toBe('POST'); routeRequests.push(JSON.parse(init!.body as string))
      if (failRoute) return Response.json({ error: 'Unresolved airway' }, { status: 502 })
      return Response.json({ origin: 'VTST', destination: 'VTBD', errors: [], cycle: '2609', entryRouteSource: 'AIP_INFERRED',
        entryTransition: { via: 'HOTEL', path: ['SABAI'], source: 'AIP fixture' }, segments: [{
          from: { identifier: 'HOTEL', coordinates: { lat: 10, lon: 100 } },
          to: { identifier: 'SABAI', coordinates: { lat: 13, lon: 100 } }, distance: 180, cumulativeDistance: 180,
        }] })
    }
    throw new Error(`Unexpected request: ${input}`)
  }))
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('uses the displayed runway in the API request, including a controller change on the next traffic tick', async () => {
  await act(async () => root.render(<App />))
  expect(routeRequests[0]).toMatchObject({ arrivalRunway: '21R', entryFix: 'SABAI', route: 'TRN Y99 HOTEL' })
  const row = container.querySelector<HTMLElement>('.aman-flight-row[data-airport="VTBD"]')!
  const select = row.querySelector<HTMLSelectElement>('select')!
  expect(select.value).toBe('21R')
  expect(container.querySelector('.aman-inbound-row[data-airport="VTBD"]')?.textContent).toContain('ENTRY EST')
  await act(async () => { select.value = '21L'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(routeRequests.at(-1)?.arrivalRunway).toBe('21L')
})

it('visibly labels FPL fallback and retains the route error in the row details', async () => {
  failRoute = true
  await act(async () => root.render(<App />))
  const row = container.querySelector<HTMLElement>('.aman-inbound-row[data-airport="VTBD"]')!
  expect(row.textContent).toContain('FPL EST')
  expect(row.title).toContain('ROUTE UNAVAILABLE')
  expect(row.title).toContain('Unresolved airway')
})
