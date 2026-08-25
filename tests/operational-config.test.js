import { describe, expect, it } from 'vitest'
import { isEffective, newestEffectiveTimings } from '../functions/api/sequence/operational-config.js'

describe('operational master timing selection', () => {
  it('uses only active rows effective on the service date', () => {
    expect(isEffective({ active: true, effective_from: '2026-08-01', effective_to: null }, '2026-08-25')).toBe(true)
    expect(isEffective({ active: true, effective_from: '2026-08-26', effective_to: null }, '2026-08-25')).toBe(false)
    expect(isEffective({ active: true, effective_from: '2026-08-01', effective_to: '2026-08-24' }, '2026-08-25')).toBe(false)
    expect(isEffective({ active: false, effective_from: '2026-08-01', effective_to: null }, '2026-08-25')).toBe(false)
  })

  it('chooses the newest effective revision for each airport flow and fix', () => {
    const rows = [
      { id: 1, airport: 'VTBD', flow: '21', fix: 'NAKON', nominal_seconds: 780, active: true, effective_from: '2026-01-01', effective_to: null },
      { id: 2, airport: 'VTBD', flow: '21', fix: 'NAKON', nominal_seconds: 840, active: true, effective_from: '2026-08-01', effective_to: null },
      { id: 3, airport: 'VTBD', flow: '21', fix: 'WEHHA', nominal_seconds: 780, active: true, effective_from: '2026-01-01', effective_to: null },
    ]
    const selected = newestEffectiveTimings(rows, '2026-08-25')
    expect(selected).toHaveLength(2)
    expect(selected.find((row) => row.fix === 'NAKON')?.id).toBe(2)
  })
})
