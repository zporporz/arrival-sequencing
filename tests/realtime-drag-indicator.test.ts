import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRealtimeAmanRuntime } from '../src/realtimeAmanRuntime'

class Socket extends EventTarget {
  static OPEN = 1
  static CLOSED = 3
  static instances: Socket[] = []
  readyState = Socket.OPEN
  sent: any[] = []
  constructor(readonly url: string) { super(); Socket.instances.push(this) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  close() { this.readyState = Socket.CLOSED; this.dispatchEvent(new Event('close')) }
  receive(message: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })) }
}

const rowHtml = (airport = 'VTBS', callsign = 'THA123') => `<div class="aman-flight-row" title="${airport} RWY 19"><span class="tldt">10:20</span><strong>${callsign}</strong><span>A320</span><span>N</span><span>10:05</span><b>0</b><em class="runway-assignment">19</em></div>`
const badge = () => document.querySelector<HTMLElement>('.aman-realtime-drag-badge')
const row = () => document.querySelector<HTMLElement>('.aman-flight-row')!
const socket = (airport = 'VTBS') => Socket.instances.find(item => item.url.includes(`airport=${airport}`))!
const lock = (overrides: Record<string, unknown> = {}) => ({ type: 'drag_lock', airport: 'VTBS', callsign: 'THA123',
  previewId: 'drag-one', actor: { name: 'Ecgkasit Bunyakhachai', vid: '739898' }, expiresAt: Date.now() + 5_000, ...overrides })
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-13T10:00:00Z')
  Socket.instances = []; vi.stubGlobal('WebSocket', Socket)
  document.body.innerHTML = rowHtml()
})
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = ''
  vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('visible remote drag owner', () => {
  it('shows the actor without changing any timing column; release shows SAVING and unlock removes it', () => {
    dispose = installRealtimeAmanRuntime()
    const originalColumns = [...row().children].map(child => child.textContent)
    socket().receive(lock())
    const originalBadge = badge()
    expect(originalBadge?.textContent).toBe('DRAGGING · Ecgkasit Bunyakhachai')
    expect(originalBadge?.getAttribute('aria-label')).toContain('THA123')
    socket().receive(lock({ type: 'drag_preview', rows: [] }))
    expect(badge()).toBe(originalBadge)
    expect([...row().children].slice(0, 7).map(child => child.textContent)).toEqual(originalColumns)
    socket().receive({ type: 'drag_release', airport: 'VTBS', callsign: 'THA123', previewId: 'drag-one', targetAt: '2026-09-13T10:25:00Z', runway: '19' })
    expect(badge()?.textContent).toBe('SAVING · Ecgkasit Bunyakhachai')
    socket().receive({ type: 'flight_commit', airport: 'VTBS', preservePreview: true, flightState: { airport: 'VTBS', callsign: 'THA123', revision: 5 } })
    expect(badge()?.dataset.phase).toBe('SAVING')
    socket().receive({ type: 'drag_unlock', callsign: 'THA123', previewId: 'drag-one' })
    expect(badge()).toBeNull()
    expect(row().dataset.realtimeLockActor).toBeUndefined()
  })

  it('keeps a newer owner and its expiry when an older unlock arrives', async () => {
    dispose = installRealtimeAmanRuntime()
    socket().receive(lock())
    socket().receive(lock({ previewId: 'drag-two', actor: { name: 'Controller Two' }, expiresAt: Date.now() + 10_000 }))
    socket().receive({ type: 'drag_unlock', callsign: 'THA123', previewId: 'drag-one' })
    expect(badge()?.textContent).toBe('DRAGGING · Controller Two')
    await vi.advanceTimersByTimeAsync(5_100)
    expect(badge()?.textContent).toContain('Controller Two')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(badge()).toBeNull()
  })

  it('shows a snapshot owner when traffic arrives later, including saving releases', async () => {
    document.body.innerHTML = ''
    dispose = installRealtimeAmanRuntime()
    socket().receive({ type: 'room_snapshot', dragLocks: [lock()], pendingReleases: [{ callsign: 'THA123', previewId: 'drag-one' }] })
    document.body.innerHTML = rowHtml()
    await vi.advanceTimersByTimeAsync(0)
    expect(badge()?.textContent).toBe('SAVING · Ecgkasit Bunyakhachai')
    row().outerHTML = rowHtml()
    await vi.advanceTimersByTimeAsync(0)
    expect(badge()?.textContent).toContain('Ecgkasit')
  })

  it('blocks a concurrent drag even if React replaced the row className', () => {
    dispose = installRealtimeAmanRuntime()
    socket().receive(lock())
    row().className = 'aman-flight-row'
    row().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(socket().sent.some(message => message.type === 'drag_begin')).toBe(false)
    expect(document.querySelector('.aman-runtime-toast')?.textContent).toContain('Ecgkasit')
  })

  it('renders names as plain text and falls back to VID when a name is missing', () => {
    dispose = installRealtimeAmanRuntime()
    socket().receive(lock({ actor: { name: '<img src=x onerror=alert(1)>' } }))
    expect(badge()?.textContent).toContain('<img')
    expect(badge()?.querySelector('img')).toBeNull()
    socket().receive(lock({ actor: { vid: '123456' } }))
    expect(badge()?.textContent).toBe('DRAGGING · 123456')
  })

  it.each(['cancel', 'disconnect', 'dispose', 'midnight', 'airport-change'])('cleans the owner on %s', async action => {
    document.body.innerHTML = '<div class="aman-airport-scope-picker"><input type="checkbox" checked value="VTBS"><input type="checkbox" checked value="VTBD"></div>' + rowHtml()
    if (action === 'midnight') vi.setSystemTime('2026-09-13T23:59:59Z')
    dispose = installRealtimeAmanRuntime()
    socket().receive(lock())
    if (action === 'cancel') socket().receive({ type: 'drag_cancel', previewId: 'drag-one' })
    if (action === 'disconnect') socket().close()
    if (action === 'dispose') { dispose(); dispose = undefined }
    if (action === 'midnight') await vi.advanceTimersByTimeAsync(1_100)
    if (action === 'airport-change') {
      document.querySelector<HTMLInputElement>('input[value="VTBS"]')!.value = 'VTCC'
      window.dispatchEvent(new Event('aman:airport-selection-change'))
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(badge()).toBeNull()
    expect(row().dataset.realtimeLockActor).toBeUndefined()
  })
})
