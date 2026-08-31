import { describe, expect, it } from 'vitest'
import { formatRoundedHmUtc } from '../src/core/minuteRounding'

describe('operational minute rounding', () => {
  it.each([
    ['2026-08-31T10:50:00.000Z', '10:50'],
    ['2026-08-31T10:50:29.999Z', '10:50'],
    ['2026-08-31T10:50:30.999Z', '10:50'],
    ['2026-08-31T10:50:31.000Z', '10:51'],
    ['2026-08-31T10:50:59.999Z', '10:51'],
    ['2026-08-31T23:59:31.000Z', '00:00'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatRoundedHmUtc(value)).toBe(expected)
  })
})
