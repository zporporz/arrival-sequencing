import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSharedAmanRuntime } from '../src/sharedAmanRuntime'
import { installTimelineReadableRuntime } from '../src/timelineReadableRuntime'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('shared runtime consolidation', () => {
  it('restores a persisted MANUAL target when its live row renders after shared state', async () => {
    const serviceDate = new Date().toISOString().slice(0, 10)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      serviceDate,
      workspaceStates: [],
      flightStates: [{
        service_date: serviceDate,
        airport: 'VTBS',
        callsign: 'THA123',
        connection_phase: 'ACTIVE',
        target_mode: 'MANUAL',
        manual_tldt: new Date(Date.now() + 5 * 60_000).toISOString(),
        manual_runway: '19',
        revision: 7,
      }],
      sequenceOrders: [],
    }))

    const pointerDown = vi.fn()
    const pointerMove = vi.fn()
    const pointerUp = vi.fn()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const removeRuntime = installSharedAmanRuntime()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

    const row = document.createElement('div')
    row.className = 'aman-flight-row'
    row.title = 'VTBS RWY 19'
    row.style.setProperty('--offset-px', '0px')
    row.innerHTML = `
      <span class="tldt">10:00</span><strong>THA123</strong>
      <em class="runway-assignment"><select><option selected>19</option></select></em>
    `
    Object.defineProperty(row, '__reactProps$test', {
      value: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp },
      enumerable: true,
    })
    document.body.appendChild(row)

    await vi.waitFor(() => expect(pointerUp).toHaveBeenCalledTimes(1), { timeout: 1_500 })
    await new Promise((resolve) => window.setTimeout(resolve, 1_050))

    expect(pointerDown).toHaveBeenCalledTimes(1)
    expect(pointerMove).toHaveBeenCalledTimes(1)
    expect(pointerUp).toHaveBeenCalledTimes(1)
    expect(row.dataset.sharedRevision).toBe('7')
    expect(row.dataset.targetMode).toBe('MANUAL')

    removeRuntime()
  })

  it('keeps minute-only TLDT formatting without the compatibility runtime', () => {
    document.body.innerHTML = `
      <div class="aman-flight-row" title="STA/TLDT 10:20:31Z">
        <span class="tldt">10:20:31</span><strong>THA123</strong>
      </div>
    `

    const removeRuntime = installTimelineReadableRuntime()

    expect(document.querySelector('.tldt')?.textContent).toBe('10:21')

    removeRuntime()
  })
})
