import { afterEach, describe, expect, it } from 'vitest'
import { mergeAirportRefresh } from '../src/AppMaestroV24'
import { installMaestroOpsMenuRuntime } from '../src/maestroOpsMenuRuntime'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('airport-scoped recompute', () => {
  it('replaces only the requested airport data', () => {
    const current = [
      { airport: 'VTBD' as const, value: 'BD-old' },
      { airport: 'VTBS' as const, value: 'BS-old' },
    ]
    const refreshed = [{ airport: 'VTBS' as const, value: 'BS-new' }]

    expect(mergeAirportRefresh(current, refreshed, ['VTBS'], (item) => item.airport)).toEqual([
      { airport: 'VTBD', value: 'BD-old' },
      { airport: 'VTBS', value: 'BS-new' },
    ])
  })

  it('dispatches recompute for the airport belonging to the clicked strip', () => {
    document.body.innerHTML = '<div class="aman-flight-row" title="VTBS RWY 19"><strong>THA123</strong></div>'
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    let detail: unknown = null
    const onRecompute = (event: Event) => { detail = (event as CustomEvent).detail }
    window.addEventListener('aman:recompute-airport', onRecompute)
    const remove = installMaestroOpsMenuRuntime()

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))
    const recompute = Array.from(document.querySelectorAll<HTMLButtonElement>('.aman-runtime-ops-menu button'))
      .find((button) => button.textContent === 'Recompute VTBS')
    recompute?.click()

    expect(detail).toEqual({ airport: 'VTBS', demo: false })
    remove()
    window.removeEventListener('aman:recompute-airport', onRecompute)
  })
})
