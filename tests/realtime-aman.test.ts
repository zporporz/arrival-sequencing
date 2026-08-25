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
})
