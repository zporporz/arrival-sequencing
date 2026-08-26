import { describe, expect, it } from 'vitest'
import { dragVisualCommitReady } from '../src/timelineDisplayScaleRuntime'

describe('timeline drag visual handoff', () => {
  it('holds the released strip while React still exposes the original TLDT', () => {
    expect(dragVisualCommitReady(90, 90, 90, 54)).toBe(false)
  })

  it('hands the strip to the committed TLDT without an old-position frame', () => {
    expect(dragVisualCommitReady(90, 54, 90, 54)).toBe(true)
  })

  it('does not delay a click that produced no drag movement', () => {
    expect(dragVisualCommitReady(90, 90, 90, 90)).toBe(true)
  })
})
