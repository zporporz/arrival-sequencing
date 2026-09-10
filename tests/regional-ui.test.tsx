import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bundle from '../functions/_data/regional-arrivals.json'
const mocks = vi.hoisted(() => ({ nav: vi.fn(), snapshot: vi.fn(), profile: vi.fn() }))
vi.mock('../src/core/regionalPreviewData', () => ({ readRegionalNav: mocks.nav, readRegionalSnapshot: mocks.snapshot, previewPerformance: mocks.profile }))
import RegionalAman from '../src/RegionalAman'
let root: Root, container: HTMLDivElement
const performance = { source: 'SIMBRIEF', aircraftType: 'A320', performanceCategory: 'C', descentProfile: '78/280/250', descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 }
describe('regional page', () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    window.history.replaceState(null, '', '/?regional=VTCC')
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    mocks.nav.mockImplementation(async (airport) => ({ cycle: bundle.cycle, source: bundle.source, airport: bundle.airports[airport as 'VTCC'] }))
    mocks.snapshot.mockImplementation(async (nav) => ({ traffic: { airport: nav.airport.code, fetchedAt: new Date().toISOString(), flights: [] }, profiles: {}, routes: {} }))
    mocks.profile.mockResolvedValue(performance)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
  it('shows the calculator without requiring live traffic and keeps operational controls absent', async () => {
    await act(async () => root.render(<RegionalAman />))
    expect(container.textContent).toContain('No connected IFR arrivals for VTCC')
    expect(container.textContent).toContain('78/280/250')
    expect(container.textContent).toContain('ADLU2B → R18')
    expect(container.textContent).toContain('ไม่เขียนทับคิวควบคุมร่วม')
    expect(container.querySelector('.aman-app')).toBeNull()
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })
  it('switches airport and default approach without retaining the previous airport data', async () => {
    await act(async () => root.render(<RegionalAman />))
    const select = container.querySelector('select')!
    await act(async () => { select.value = 'VTSP'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.textContent).toContain('No connected IFR arrivals for VTSP')
    expect(container.textContent).not.toContain('No connected IFR arrivals for VTCC')
    expect(container.textContent).toContain('→ I27')
  })
  it('keeps unavailable aircraft visible with a reason', async () => {
    mocks.snapshot.mockResolvedValue({ traffic: { airport: 'VTCC', fetchedAt: new Date().toISOString(), flights: [{ sessionId: '1', callsign: 'TEST999', aircraft: 'A320', route: 'DCT UNKNOWN', state: 'Boarding' }] }, profiles: {}, routes: {} })
    await act(async () => root.render(<RegionalAman />))
    expect(container.textContent).toContain('TEST999')
    expect(container.textContent).toContain('STAR unresolved')
  })
  it('fails closed when active AIRAC cannot be verified', async () => {
    mocks.nav.mockRejectedValue(new Error('AIRAC mismatch'))
    await act(async () => root.render(<RegionalAman />))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('AIRAC mismatch')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Route calculator')
  })
})
