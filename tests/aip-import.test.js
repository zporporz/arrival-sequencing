import { describe, expect, it } from 'vitest'
import { runwayFlowFromApplicability } from '../functions/api/admin/aip-import.js'

describe('CAAT runway draft mapping', () => {
  it('creates a stable flow key from a CAAT runway group', () => {
    expect(runwayFlowFromApplicability('18 / 36')).toBe('18_36')
    expect(runwayFlowFromApplicability('RWY 20R / 19 / 20L')).toBe('19_20L_20R')
  })

  it('deduplicates runway identifiers and rejects unknown labels', () => {
    expect(runwayFlowFromApplicability('09 / 09 / 27')).toBe('09_27')
    expect(runwayFlowFromApplicability('ALL RUNWAYS')).toBeNull()
  })
})
