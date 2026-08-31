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
  it('saves a programmatic LAND SEP reset to the shared workspace', async () => {
    const serviceDate = new Date().toISOString().slice(0, 10)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ serviceDate, workspaceStates: [], flightStates: [], sequenceOrders: [] }))
      .mockResolvedValueOnce(jsonResponse({
        workspaceState: {
          service_date: serviceDate,
          airport: 'VTBS',
          profile_id: 'CUSTOM',
          runway_modes: { '19': 'MIX', '20L': 'DEP', '20R': 'ARR' },
          spacing_nm: { '19': 5.5, '20L': 8, '20R': 6 },
          revision: 2,
        },
      }))
    document.body.innerHTML = `
      <div class="aman-runway-config-block">
        <div class="aman-profile-select"><span>VTBS CONFIG</span><select><option selected>CUSTOM</option></select></div>
        <div class="aman-runway-card"><b>19</b><select><option selected>MIX</option></select><input value="5.5"></div>
        <div class="aman-runway-card"><b>20L</b><select><option selected>DEP</option></select><input value="8"></div>
        <div class="aman-runway-card"><b>20R</b><select><option selected>ARR</option></select><input value="6"></div>
      </div>`
    const removeRuntime = installSharedAmanRuntime()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new CustomEvent('aman:workspace-config-change', { detail: { airport: 'VTBS' } }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 1_000 })

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      action: 'syncWorkspace',
      airport: 'VTBS',
      spacingNm: { '19': 5.5, '20L': 8, '20R': 6 },
    })
    removeRuntime()
  })

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

  it('applies a realtime MANUAL commit immediately and only once', async () => {
    const serviceDate = new Date().toISOString().slice(0, 10)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      serviceDate,
      workspaceStates: [],
      flightStates: [],
      sequenceOrders: [],
    }))
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const pointerDown = vi.fn()
    const pointerMove = vi.fn()
    const pointerUp = vi.fn()
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

    const removeRuntime = installSharedAmanRuntime()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

    const committedState = {
      service_date: serviceDate,
      airport: 'VTBS',
      callsign: 'THA123',
      connection_phase: 'ACTIVE',
      target_mode: 'MANUAL',
      manual_tldt: new Date(Date.now() + 7 * 60_000).toISOString(),
      manual_runway: '19',
      revision: 8,
    }
    window.dispatchEvent(new CustomEvent('aman:realtime-flight-state', { detail: committedState }))

    expect(pointerDown).toHaveBeenCalledTimes(1)
    expect(pointerMove).toHaveBeenCalledTimes(1)
    expect(pointerUp).toHaveBeenCalledTimes(1)
    expect(pointerDown.mock.calls[0]?.[0]).toMatchObject({ button: 0 })
    expect(row.dataset.sharedRevision).toBe('8')
    expect(row.dataset.targetMode).toBe('MANUAL')

    window.dispatchEvent(new CustomEvent('aman:realtime-flight-state', {
      detail: { ...committedState, revision: 7 },
    }))

    expect(pointerUp).toHaveBeenCalledTimes(1)

    removeRuntime()
  })

  it('applies a realtime drag release before the persisted revision arrives', async () => {
    const serviceDate = new Date().toISOString().slice(0, 10)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      serviceDate,
      workspaceStates: [],
      flightStates: [],
      sequenceOrders: [],
    }))
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const pointerDown = vi.fn()
    const pointerMove = vi.fn()
    const pointerUp = vi.fn()
    const row = document.createElement('div')
    row.className = 'aman-flight-row'
    row.title = 'VTBS RWY 19'
    // Realtime preview has already moved the DOM to the released position.
    // React still owns the original target, so the release must use the
    // pre-preview target as its drag baseline instead of reading this offset.
    row.style.setProperty('--offset-px', '-70px')
    row.innerHTML = `
      <span class="tldt">10:00</span><strong>THA123</strong>
      <em class="runway-assignment"><select><option selected>19</option></select></em>
    `
    Object.defineProperty(row, '__reactProps$test', {
      value: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp },
      enumerable: true,
    })
    document.body.appendChild(row)

    const removeRuntime = installSharedAmanRuntime()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    window.dispatchEvent(new CustomEvent('aman:realtime-manual-release', {
      detail: {
        airport: 'VTBS', callsign: 'THA123', previewId: 'preview-one', runway: '19',
        targetAt: new Date(Date.now() + 7 * 60_000).toISOString(),
        originalTargetAt: new Date().toISOString(), originalRunway: '19', originalWasManual: false,
      },
    }))

    expect(pointerDown).toHaveBeenCalledTimes(1)
    expect(pointerMove).toHaveBeenCalledTimes(1)
    expect(pointerUp).toHaveBeenCalledTimes(1)
    expect(pointerMove.mock.calls[0]?.[0]?.clientY).toBeCloseTo(-70, 0)
    expect(pointerUp.mock.calls[0]?.[0]?.clientY).toBeCloseTo(-70, 0)
    expect(row.dataset.targetMode).toBe('MANUAL')
    expect(row.dataset.realtimeReleasePreview).toBe('preview-one')

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
