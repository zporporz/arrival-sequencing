import { describe, expect, it } from 'vitest'
import { retainUnchangedOperationalConfig } from '../src/core/operationalConfigIdentity'
import type { OperationalConfigPayload } from '../src/core/api'

const fixture = (): OperationalConfigPayload => ({
  serviceDate: '2026-09-13', generatedAt: '2026-09-13T01:00:00Z',
  workspaces: [{ airport: 'VTBD', airportName: 'Don Mueang', flow: '21', label: 'South',
    timings: [{ airport: 'VTBD', flow: '21', fix: 'SEHNA', nominalSeconds: 780,
      source: 'MASTER', verified: true, effectiveFrom: '2026-09-01', effectiveTo: null, updatedAt: '2026-09-01T00:00:00Z' }],
  }],
})

describe('operational timing config identity', () => {
  it('accepts the initial config and retains state for unchanged polls/forced reads', () => {
    const current = fixture()
    expect(retainUnchangedOperationalConfig(null, current)).toBe(current)
    for (let minute = 1; minute <= 60; minute++) {
      const next = fixture(); next.generatedAt = new Date(Date.parse(current.generatedAt) + minute * 60_000).toISOString()
      expect(retainUnchangedOperationalConfig(current, next)).toBe(current)
      expect(next.generatedAt).not.toBe(current.generatedAt)
    }
  })

  it('ignores JSON object key order without mutating either response', () => {
    const current = fixture(), before = JSON.stringify(current)
    const next = JSON.parse(JSON.stringify(current, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value))
    const nextBefore = JSON.stringify(next)
    expect(retainUnchangedOperationalConfig(current, next)).toBe(current)
    expect(JSON.stringify(current)).toBe(before)
    expect(JSON.stringify(next)).toBe(nextBefore)
  })

  const changes: [string, (config: OperationalConfigPayload) => void][] = [
    ['service date', c => { c.serviceDate = '2026-09-14' }],
    ['airport', c => { c.workspaces[0].airport = 'VTBS' }],
    ['airport name', c => { c.workspaces[0].airportName = 'Renamed' }],
    ['flow', c => { c.workspaces[0].flow = '03' }],
    ['label', c => { c.workspaces[0].label = 'North' }],
    ['fix', c => { c.workspaces[0].timings[0].fix = 'WEHHA' }],
    ['time', c => { c.workspaces[0].timings[0].nominalSeconds = 900 }],
    ['timing airport', c => { c.workspaces[0].timings[0].airport = 'VTBS' }],
    ['timing flow', c => { c.workspaces[0].timings[0].flow = '03' }],
    ['source', c => { c.workspaces[0].timings[0].source = null }],
    ['verification', c => { c.workspaces[0].timings[0].verified = false }],
    ['effective start', c => { c.workspaces[0].timings[0].effectiveFrom = '2026-09-02' }],
    ['effective end', c => { c.workspaces[0].timings[0].effectiveTo = '2026-09-14' }],
    ['update timestamp', c => { c.workspaces[0].timings[0].updatedAt = null }],
    ['removed timing', c => { c.workspaces[0].timings = [] }],
    ['removed workspace', c => { c.workspaces = [] }],
    ['added workspace', c => { c.workspaces.push({ ...c.workspaces[0], airport: 'VTBS' }) }],
    ['future root field', c => { Object.assign(c, { dataRevision: 2 }) }],
    ['future nested field', c => { Object.assign(c.workspaces[0].timings[0], { generatedAt: 'meaningful nested field' }) }],
  ]
  it.each(changes)('applies a real change to %s', (_name, mutate) => {
    const current = fixture(), next = fixture()
    mutate(next)
    expect(retainUnchangedOperationalConfig(current, next)).toBe(next)
  })

  it('preserves array order because first/last matching timing entries can matter', () => {
    const current = fixture()
    current.workspaces[0].timings.push({ ...current.workspaces[0].timings[0], nominalSeconds: 800 })
    const next = structuredClone(current)
    next.workspaces[0].timings.reverse()
    expect(retainUnchangedOperationalConfig(current, next)).toBe(next)
  })
})
