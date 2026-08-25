import { describe, expect, it } from 'vitest'
import { canonicalSnapshotIsFresh, realtimeReconnectDelayMs } from '../src/realtimeAmanRuntime'

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
})
