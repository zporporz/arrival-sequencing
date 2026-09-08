import { describe, expect, it } from 'vitest'
import { enqueueFlightCommand } from '../src/flightCommandQueue'
import { findAipIawp } from '../src/aipArrivalIawp'

describe('target command ordering', () => {
  it('keeps AUTO after an in-flight manual write and permits another flight', async () => {
    const calls: string[] = []
    let finish!: () => void
    const manual = enqueueFlightCommand('A', async () => { calls.push('manual'); await new Promise<void>(resolve => { finish = resolve }) })
    const auto = enqueueFlightCommand('A', async () => { calls.push('auto') })
    await enqueueFlightCommand('B', async () => { calls.push('other') })
    expect(calls).toEqual(['manual', 'other'])
    finish()
    await Promise.all([manual, auto])
    expect(calls).toEqual(['manual', 'other', 'auto'])
  })

  it('continues after a rejected write', async () => {
    const failed = enqueueFlightCommand('failed', async () => { throw new Error('offline') })
    const next = enqueueFlightCommand('failed', async () => 'AUTO')
    await expect(failed).rejects.toThrow('offline')
    await expect(next).resolves.toBe('AUTO')
  })
})

describe('VTBS renamed STARs', () => {
  it.each(['WILA2C', 'WILA2D', 'WILA1A'])('resolves %s without an explicit upstream fix', star => {
    expect(findAipIawp('VTBS', `DCT ${star}`, ['WILLA', 'NORTA', 'EASTE'])).toMatchObject({ entryFix: 'WILLA' })
  })
  it('does not map a VTBS STAR into VTBD', () => {
    expect(findAipIawp('VTBD', 'DCT WILA2C', ['WEHHA', 'NAKON'])).toBeNull()
  })
})
