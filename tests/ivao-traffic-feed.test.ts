import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIvaoTrafficFeed } from '../src/core/ivaoTrafficFeed'
import type { IvaoTrafficPayload } from '../src/core/api'

const cleanups: (() => void)[] = []
const payload = (airport = 'VTBD'): IvaoTrafficPayload => ({ airport, fetchedAt: new Date().toISOString(), flights: [] })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-09-13T01:00:00Z') })
afterEach(async () => { cleanups.splice(0).forEach(stop => stop()); await flush(); vi.useRealTimers() })

describe('shared operational traffic feed', () => {
  it('serves three consumers on two airports with two requests per 15 seconds, not six', async () => {
    const fetcher = vi.fn(async airport => payload(airport))
    const feed = createIvaoTrafficFeed(fetcher)
    const listeners = Array.from({ length: 6 }, () => vi.fn())
    for (const [i, airport] of (['VTBD', 'VTBS'] as const).entries()) {
      for (let consumer = 0; consumer < 3; consumer++) cleanups.push(feed.subscribe(airport, listeners[i * 3 + consumer]))
    }
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(listeners[0].mock.calls[0][0].payload).toBe(listeners[2].mock.calls[0][0].payload)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(4)
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3_570_000)
    // Initial sample + 239 refreshes in [0, one hour): 480 vs the previous 1,440.
    expect(fetcher).toHaveBeenCalledTimes(480)
  })

  it('replays the latest sample to a late consumer and updates both on the original next tick', async () => {
    const fetcher = vi.fn(async () => payload())
    const feed = createIvaoTrafficFeed(fetcher), first = vi.fn(), late = vi.fn()
    cleanups.push(feed.subscribe('VTBD', first))
    await vi.advanceTimersByTimeAsync(8_000)
    cleanups.push(feed.subscribe('VTBD', late))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(late).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(late).toHaveBeenCalledTimes(2)
    expect(late.mock.calls[1][0]).toBe(first.mock.calls[1][0])
  })

  it('refreshes only the requested airport immediately and coalesces concurrent recomputes', async () => {
    const fetcher = vi.fn(async airport => payload(airport)), feed = createIvaoTrafficFeed(fetcher)
    const bd = vi.fn(), bs = vi.fn()
    cleanups.push(feed.subscribe('VTBD', bd), feed.subscribe('VTBS', bs))
    await flush()
    await vi.advanceTimersByTimeAsync(2_000)
    feed.refresh('VTBD'); feed.refresh('VTBD')
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(bd).toHaveBeenCalledTimes(2); expect(bs).toHaveBeenCalledTimes(1)
  })

  it('does not overlap slow requests or cancel another consumer when one unsubscribes', async () => {
    let finish!: (value: IvaoTrafficPayload) => void
    let signal!: AbortSignal
    const fetcher = vi.fn((_airport, requestSignal) => { signal = requestSignal; return new Promise<IvaoTrafficPayload>(resolve => { finish = resolve }) })
    const feed = createIvaoTrafficFeed(fetcher), first = vi.fn(), second = vi.fn()
    const stopFirst = feed.subscribe('VTBD', first)
    cleanups.push(stopFirst, feed.subscribe('VTBD', second))
    stopFirst(); await flush()
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    cleanups.push(feed.subscribe('VTBD', vi.fn()))
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(payload()); await flush()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('shares a failure, clears stale data, isolates airports and retries on the next 15-second tick', async () => {
    let fail = false
    const fetcher = vi.fn(async airport => {
      if (fail && airport === 'VTBD') throw new Error('503')
      return payload(airport)
    })
    const feed = createIvaoTrafficFeed(fetcher), bd = vi.fn(), bs = vi.fn(), late = vi.fn()
    cleanups.push(feed.subscribe('VTBD', bd), feed.subscribe('VTBS', bs))
    await flush(); fail = true
    await vi.advanceTimersByTimeAsync(15_000)
    expect(bd.mock.lastCall![0]).toMatchObject({ payload: null, error: new Error('503') })
    expect(bs.mock.lastCall![0].error).toBeNull()
    cleanups.push(feed.subscribe('VTBD', late))
    expect(late.mock.lastCall![0].payload).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(4)
    fail = false
    await vi.advanceTimersByTimeAsync(15_000)
    expect(bd.mock.lastCall![0].error).toBeNull()
    expect(late.mock.lastCall![0].payload).toBe(bd.mock.lastCall![0].payload)
  })

  it('rejects a malformed/wrong-airport response instead of sharing it as healthy data', async () => {
    const feed = createIvaoTrafficFeed(async () => payload('VTBS')), listener = vi.fn()
    cleanups.push(feed.subscribe('VTBD', listener))
    await flush()
    expect(listener.mock.lastCall![0]).toMatchObject({ airport: 'VTBD', payload: null, error: new Error('Invalid traffic response') })
  })

  it('times out a stuck request and recovers on the next tick', async () => {
    const fetcher = vi.fn((_airport, signal: AbortSignal) => new Promise<IvaoTrafficPayload>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const feed = createIvaoTrafficFeed(fetcher), listener = vi.fn()
    cleanups.push(feed.subscribe('VTBD', listener))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(listener.mock.lastCall![0].error.name).toBe('TimeoutError')
    fetcher.mockResolvedValueOnce(payload())
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(listener.mock.lastCall![0].error).toBeNull()
  })

  it('stops unused airports and ignores late results from a disposed session', async () => {
    let finish!: (value: IvaoTrafficPayload) => void
    let signal!: AbortSignal
    const fetcher = vi.fn((_airport, requestSignal) => { signal = requestSignal; return new Promise<IvaoTrafficPayload>(resolve => { finish = resolve }) })
    const feed = createIvaoTrafficFeed(fetcher), old = vi.fn()
    const stop = feed.subscribe('VTBD', old)
    stop(); await flush()
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish(payload()); await flush()
    expect(old).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(payload())
    const next = vi.fn()
    cleanups.push(feed.subscribe('VTBD', next)); await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(next.mock.lastCall![0].error).toBeNull()
  })

  it('keeps the same request and cadence during synchronous effect re-subscriptions', async () => {
    const fetcher = vi.fn(async () => payload()), feed = createIvaoTrafficFeed(fetcher)
    const first = vi.fn(), next = vi.fn()
    feed.subscribe('VTBD', first)()
    cleanups.push(feed.subscribe('VTBD', next))
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not let a throwing consumer break the other consumers or subsequent samples', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const feed = createIvaoTrafficFeed(async () => payload()), healthy = vi.fn()
    cleanups.push(feed.subscribe('VTBD', () => { throw new Error('consumer failed') }), feed.subscribe('VTBD', healthy))
    await flush()
    expect(healthy.mock.lastCall![0].error).toBeNull()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(healthy).toHaveBeenCalledTimes(2)
  })
})
