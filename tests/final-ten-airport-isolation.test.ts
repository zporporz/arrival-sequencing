import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFinalTenNmRuntime } from '../src/finalTenNmRuntime'

function row(airport: 'VTBD' | 'VTBS', callsign: string) {
  const runway = airport === 'VTBD' ? '21R' : '19'
  return `<div class="aman-flight-row" title="${airport} RWY ${runway}">
    <strong>${callsign}</strong>
    <span class="runway-assignment">${airport === 'VTBD' ? 'BD' : 'BS'}/${runway}</span>
  </div>`
}

function traffic(airport: 'VTBD' | 'VTBS', callsign: string) {
  return {
    airport,
    flights: [{
      callsign,
      latitude: airport === 'VTBS' ? 13.772 : 14.005,
      longitude: airport === 'VTBS' ? 100.781 : 100.640,
      heading: airport === 'VTBS' ? 194.42 : 209,
      onGround: false,
      trackTimestamp: new Date().toISOString(),
    }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('per-airport Final 10 NM traffic health', () => {
  it.each([
    ['VTBD', 'VTBS'],
    ['VTBS', 'VTBD'],
  ] as const)('keeps %s unavailable without disabling healthy %s traffic', async (failedAirport, healthyAirport) => {
    document.body.innerHTML = row('VTBD', 'DMK1') + row('VTBS', 'BKK1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const requestedAirport = new URL(String(input), 'https://example.test').searchParams.get('airport') as 'VTBD' | 'VTBS'
      if (requestedAirport === failedAirport) return new Response('unavailable', { status: 503 })
      const callsign = requestedAirport === 'VTBD' ? 'DMK1' : 'BKK1'
      return Response.json(traffic(requestedAirport, callsign))
    }))

    const dispose = installFinalTenNmRuntime()
    const failedRow = document.querySelector<HTMLElement>(`.aman-flight-row[title^="${failedAirport}"]`)!
    const healthyRow = document.querySelector<HTMLElement>(`.aman-flight-row[title^="${healthyAirport}"]`)!

    await vi.waitFor(() => {
      expect(failedRow.dataset.finalGeometryAvailable).toBe('false')
      expect(healthyRow.dataset.finalGeometryAvailable).toBe('true')
    })

    dispose()
  })
})
