import { describe, expect, it } from 'vitest'
import {
  APPROACH_CATEGORY_REFERENCE_SPEED_KT,
  frozenTargetForApproachCategory,
} from '../functions/api/sequence/aman-state.js'

describe('FROZEN approach-category target', () => {
  it('uses the conservative ICAO reference speed for each approach category', () => {
    expect(APPROACH_CATEGORY_REFERENCE_SPEED_KT).toEqual({
      A: 90,
      B: 120,
      C: 140,
      D: 165,
      E: 210,
      H: 90,
    })
  })

  it('calculates a category C TLDT from the live track sample and final distance', () => {
    expect(frozenTargetForApproachCategory({
      approachCategory: 'C',
      distanceNm: 10,
      trackAt: '2026-08-31T10:00:00.000Z',
    })).toEqual({
      approachCategory: 'C',
      distanceNm: 10,
      referenceSpeedKt: 140,
      trackAt: '2026-08-31T10:00:00.000Z',
      frozenTldt: '2026-08-31T10:04:17.142Z',
    })
  })

  it('rejects unknown categories and distances outside the 10 NM gate', () => {
    expect(() => frozenTargetForApproachCategory({
      approachCategory: 'F', distanceNm: 10, trackAt: '2026-08-31T10:00:00.000Z',
    })).toThrow('Valid approach category')
    expect(() => frozenTargetForApproachCategory({
      approachCategory: 'C', distanceNm: 10.1, trackAt: '2026-08-31T10:00:00.000Z',
    })).toThrow('between 0 and 10 NM')
  })
})
