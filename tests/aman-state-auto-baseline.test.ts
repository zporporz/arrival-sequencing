import { describe, expect, it } from 'vitest'
import { autoBaselineForManualTarget } from '../functions/api/sequence/aman-state.js'

describe('shared AUTO baseline', () => {
  it('captures the server-shared AUTO position when the first manual drag begins', () => {
    expect(autoBaselineForManualTarget(
      { target_mode: 'AUTO' },
      {
        autoBaselineTldt: '2026-08-28T10:15:00.000Z',
        autoBaselineRunway: '19',
        autoBaselineRank: 3,
      },
      '2026-08-28T10:00:00.000Z',
    )).toEqual({
      auto_baseline_tldt: '2026-08-28T10:15:00.000Z',
      auto_baseline_runway: '19',
      auto_baseline_rank: 3,
      auto_baseline_captured_at: '2026-08-28T10:00:00.000Z',
    })
  })

  it('does not replace the baseline during later drags in the same manual session', () => {
    expect(autoBaselineForManualTarget(
      {
        target_mode: 'MANUAL',
        auto_baseline_tldt: '2026-08-28T10:15:00.000Z',
        auto_baseline_runway: '19',
        auto_baseline_rank: 3,
        auto_baseline_captured_at: '2026-08-28T10:00:00.000Z',
      },
      {
        autoBaselineTldt: '2026-08-28T10:25:00.000Z',
        autoBaselineRunway: '20R',
        autoBaselineRank: 7,
      },
      '2026-08-28T10:05:00.000Z',
    )).toEqual({
      auto_baseline_tldt: '2026-08-28T10:15:00.000Z',
      auto_baseline_runway: '19',
      auto_baseline_rank: 3,
      auto_baseline_captured_at: '2026-08-28T10:00:00.000Z',
    })
  })
})
