import { afterEach, describe, expect, it, vi } from 'vitest'
import { installInteractionGuardRuntime } from '../src/interactionGuardRuntime'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('return to AUTO interaction guard', () => {
  it('updates locally once and publishes the saved AUTO state without waiting for polling', async () => {
    const flightState = {
      service_date: '2026-08-25',
      airport: 'VTBS',
      callsign: 'THA123',
      target_mode: 'AUTO',
      manual_tldt: null,
      manual_runway: null,
      revision: 7,
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, flightState }),
    })
    vi.stubGlobal('fetch', fetchMock)

    document.body.innerHTML = '<div class="aman-flight-row is-stable" data-target-mode="MANUAL" title="VTBS RWY 19"><strong>THA123</strong></div>'
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    const reset = vi.fn()
    Object.defineProperty(row, '__reactProps$test', {
      value: { onDoubleClick: reset },
      configurable: true,
      enumerable: true,
    })

    const commits: unknown[] = []
    const applied: unknown[] = []
    const onCommit = (event: Event) => commits.push((event as CustomEvent).detail)
    const onApplied = (event: Event) => applied.push((event as CustomEvent).detail)
    window.addEventListener('aman:realtime-commit-request', onCommit)
    window.addEventListener('aman:realtime-flight-state', onApplied)
    const remove = installInteractionGuardRuntime()

    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(reset).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(commits).toHaveLength(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(applied).toEqual([flightState])
    expect(commits).toEqual([{ airport: 'VTBS', flightState }])
    expect(reset).toHaveBeenCalledTimes(1)

    remove()
    window.removeEventListener('aman:realtime-commit-request', onCommit)
    window.removeEventListener('aman:realtime-flight-state', onApplied)
  })
})
