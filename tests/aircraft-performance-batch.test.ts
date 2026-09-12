import { describe, expect, it, vi } from 'vitest'
import { createAircraftPerformanceBatch } from '../src/core/aircraftPerformanceBatch'
import type { AircraftPerformancePayload } from '../src/core/api'

describe('per-refresh aircraft profile requests', () => {
  it('normalizes repeated types and shares pending and completed results', async () => {
    let finish!: (payload: AircraftPerformancePayload) => void
    const fetcher = vi.fn(() => new Promise<AircraftPerformancePayload>(resolve => { finish = resolve }))
    const read = createAircraftPerformanceBatch(fetcher)
    const first = read(' a320 '), second = read('A320')
    expect(second).toBe(first)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('A320')
    const payload = { type: 'A320', found: false }
    finish(payload)
    expect(await first).toBe(payload)
    expect(await read('a320')).toBe(payload)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct aircraft models separate and skips missing types', async () => {
    const fetcher = vi.fn(async type => ({ type, found: false }))
    const read = createAircraftPerformanceBatch(fetcher)
    expect(await Promise.all(['A320', 'A20N', 'B738', '', '  ', null, undefined].map(read)))
      .toEqual([{ type: 'A320', found: false }, { type: 'A20N', found: false }, { type: 'B738', found: false }, null, null, null, null])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('gets fresh data in the next batch, including overlapping refreshes', async () => {
    const fetcher = vi.fn(async type => ({ type, found: false }))
    const first = createAircraftPerformanceBatch(fetcher), next = createAircraftPerformanceBatch(fetcher)
    const a = first('A320'), b = next('A320')
    expect(a).not.toBe(b)
    await Promise.all([a, b])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shares the existing failure fallback without poisoning the next refresh', async () => {
    const fetcher = vi.fn(async type => ({ type, found: false }))
      .mockRejectedValueOnce(new Error('503'))
    const first = createAircraftPerformanceBatch(fetcher)
    expect(await Promise.all([first('B738'), first('B738'), first('A320')]))
      .toEqual([null, null, { type: 'A320', found: false }])
    expect(await first('B738')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await createAircraftPerformanceBatch(fetcher)('B738')).toEqual({ type: 'B738', found: false })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('reduces ten flights with three types from 2,400 to 720 requests in 240 batches', async () => {
    const types = ['A320', 'A320', 'B738', 'A20N', 'A320', 'B738', 'A20N', 'A320', 'B738', 'A320']
    const fetcher = vi.fn(async type => ({ type, found: false }))
    for (let round = 0; round < 240; round++) {
      await Promise.all(types.map(createAircraftPerformanceBatch(fetcher)))
    }
    expect(fetcher).toHaveBeenCalledTimes(720)
    expect(1 - fetcher.mock.calls.length / (types.length * 240)).toBeCloseTo(0.7)
  })
})
