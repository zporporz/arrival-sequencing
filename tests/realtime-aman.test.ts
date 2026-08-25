import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalSnapshotIsFresh,
  installRealtimeAmanRuntime,
  millisecondsUntilNextUtcServiceDate,
  realtimeReconnectDelayMs,
  realtimeUtcServiceDate,
} from '../src/realtimeAmanRuntime'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('realtime AMAN coordination', () => {
  it('uses bounded exponential reconnect delays', () => {
    expect([0, 1, 2, 3, 4, 5, 8].map(realtimeReconnectDelayMs))
      .toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
  })

  it('accepts only a recent canonical AUTO snapshot', () => {
    const now = Date.parse('2026-08-25T10:00:00.000Z')
    expect(canonicalSnapshotIsFresh('2026-08-25T09:59:30.000Z', now)).toBe(true)
    expect(canonicalSnapshotIsFresh('2026-08-25T09:58:00.000Z', now)).toBe(false)
    expect(canonicalSnapshotIsFresh('invalid', now)).toBe(false)
  })

  it('calculates the UTC service date and the next UTC rollover boundary', () => {
    const now = Date.parse('2026-08-25T23:59:59.500Z')
    expect(realtimeUtcServiceDate(now)).toBe('2026-08-25')
    expect(millisecondsUntilNextUtcServiceDate(now)).toBe(500)
    expect(realtimeUtcServiceDate(now + 500)).toBe('2026-08-26')
  })

  it('reconnects both airport rooms into the new UTC service date at midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-25T23:59:59.500Z')

    class FakeWebSocket extends EventTarget {
      static OPEN = 1
      static CLOSED = 3
      static instances: FakeWebSocket[] = []
      readyState = FakeWebSocket.OPEN
      sent: string[] = []
      closed = false

      constructor(readonly url: string) {
        super()
        FakeWebSocket.instances.push(this)
      }

      send(payload: string) {
        this.sent.push(payload)
      }

      close() {
        this.closed = true
        this.readyState = FakeWebSocket.CLOSED
        this.dispatchEvent(new Event('close'))
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket)
    const dispose = installRealtimeAmanRuntime()

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances.every((socket) => socket.url.includes('serviceDate=2026-08-25'))).toBe(true)

    await vi.advanceTimersByTimeAsync(550)

    expect(FakeWebSocket.instances).toHaveLength(4)
    expect(FakeWebSocket.instances.slice(0, 2).every((socket) => socket.closed)).toBe(true)
    expect(FakeWebSocket.instances.slice(2).every((socket) => socket.url.includes('serviceDate=2026-08-26'))).toBe(true)

    dispose()
  })

  it('cancels a local drag when another controller owns the flight lease', () => {
    vi.useFakeTimers()

    class FakeWebSocket extends EventTarget {
      static OPEN = 1
      static CLOSED = 3
      static instances: FakeWebSocket[] = []
      readyState = FakeWebSocket.OPEN
      sent: string[] = []

      constructor(readonly url: string) {
        super()
        FakeWebSocket.instances.push(this)
      }

      send(payload: string) {
        this.sent.push(payload)
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED
        this.dispatchEvent(new Event('close'))
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket)
    document.body.innerHTML = `
      <div class="aman-flight-row" title="VTBS RWY 19" style="--offset-px:-100px">
        <strong>THA123</strong>
        <span class="runway-assignment">BS/19</span>
        <span class="tldt">10:20:00</span>
      </div>
    `
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    let pointerCancelled = false
    row.addEventListener('pointercancel', () => { pointerCancelled = true })
    const dispose = installRealtimeAmanRuntime()
    const vtbsSocket = FakeWebSocket.instances.find((socket) => socket.url.includes('airport=VTBS'))!

    const pointerDown = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(pointerDown, 'pointerId', { value: 42 })
    row.querySelector('strong')!.dispatchEvent(pointerDown)
    const begin = vtbsSocket.sent.map((payload) => JSON.parse(payload)).find((payload) => payload.type === 'drag_begin')

    vtbsSocket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'drag_denied',
      airport: 'VTBS',
      callsign: 'THA123',
      previewId: begin.previewId,
      actor: { vid: '222', name: 'CONTROLLER TWO' },
      expiresAt: Date.now() + 5_000,
    }) }))

    expect(pointerCancelled).toBe(true)
    expect(row.classList.contains('is-realtime-locked')).toBe(true)
    expect(document.querySelector('.aman-runtime-toast')?.textContent).toContain('CONTROLLER TWO')

    dispose()
    document.body.innerHTML = ''
  })
})
