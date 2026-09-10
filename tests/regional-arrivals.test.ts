import { describe, expect, it } from 'vitest'
import bundle from '../functions/_data/regional-arrivals.json'
import { calculateRegionalTiming, regionalDistanceNm, resolveRegionalStar, type RegionalAirport } from '../src/core/regionalArrivalModel'
import type { AircraftPerformanceProfile } from '../src/core/api'

const airports = bundle.airports as unknown as Record<string, RegionalAirport>
export const profile: AircraftPerformanceProfile = { source: 'SIMBRIEF', aircraftType: 'A320', aircraftName: 'Airbus A320',
  aircraftDefaultCruise: null, aircraftSpeed: null, performanceCategory: 'C', descentProfile: '78/280/250',
  descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 }
const defaults = { VTCC: { '18': 'R18', '36': 'I36-Z' }, VTSP: { '09': 'R09-Y', '27': 'I27' } }

describe('regional STAR + approach model (AIRAC source fixture)', () => {
  for (const [code, config] of Object.entries(defaults)) for (const [runway, name] of Object.entries(config)) {
    it(`${code}/${runway}: every published STAR connects to ${name}`, () => {
      const airport = airports[code]
      const approach = airport.procedures.find((p) => p.kind === 'APPROACH' && p.name === name)!
      expect(approach).toBeTruthy()
      const stars = airport.procedures.filter((p) => p.kind === 'STAR' && p.runway === runway)
      expect(stars.length).toBeGreaterThan(0)
      for (const star of stars) {
        const result = calculateRegionalTiming(airport, star, approach, profile)
        expect(result.error, `${code}/${star.name}: ${result.error}`).toBeUndefined()
        const timing = result.timing!
        expect(timing.nominalSeconds).toBeGreaterThan(120)
        expect(timing.nominalSeconds).toBeLessThan(3600)
        expect(timing.starSeconds + timing.approachSeconds).toBeCloseTo(timing.nominalSeconds)
        expect(timing.segments.every((s) => s.seconds > 0 && s.distanceNm > 0)).toBe(true)
        expect(timing.segments.at(-1)?.to.fix).toMatch(/^(RW|CC180)/)
      }
    })
  }
  const airport = airports.VTSP
  const star = airport.procedures.find((p) => p.kind === 'STAR' && p.runway === '27')!
  const approach = airport.procedures.find((p) => p.name === 'I27')!
  it('refuses open legs, missing geometry, wrong runway and absent profiles', () => {
    expect(calculateRegionalTiming(airport, star, approach, null).error).toMatch(/SimBrief/)
    expect(calculateRegionalTiming(airport, star, { ...approach, runway: '09' }, profile).error).toMatch(/mismatch/)
    expect(calculateRegionalTiming(airport, { ...star, legs: star.legs.map((l, i) => i ? l : { ...l, path: 'VM' }) }, approach, profile).error).toMatch(/Open STAR/)
    expect(calculateRegionalTiming(airport, { ...star, legs: star.legs.map((l, i) => i ? l : { ...l, lat: null }) }, approach, profile).error).toMatch(/coordinates/)
  })
  it('changes the calculated time with the SimBrief speed schedule and wind assumption', () => {
    const base = calculateRegionalTiming(airport, star, approach, profile).timing!
    const slower = calculateRegionalTiming(airport, star, approach, { ...profile, descentBelow10000IasKt: 200 }).timing!
    const headwind = calculateRegionalTiming(airport, star, approach, profile, -20).timing!
    expect(slower.nominalSeconds).toBeGreaterThan(base.nominalSeconds)
    expect(headwind.nominalSeconds).toBeGreaterThan(base.nominalSeconds)
  })
  it('does not substitute a filed STAR from a different runway', () => {
    expect(resolveRegionalStar(airport, star.runway, star.name)?.id).toBe(star.id)
    expect(resolveRegionalStar(airport, '09', star.name)).toBeNull()
    const entry = star.legs[0].fix!
    const matching = airport.procedures.filter((p) => p.kind === 'STAR' && p.runway === '27' && p.legs[0]?.fix === entry)
    if (matching.length === 1) expect(resolveRegionalStar(airport, '27', `SID1A DCT ${entry}`)?.id).toBe(star.id)
    expect(resolveRegionalStar(airport, '27', `SID1A DCT ${entry} UNKN9Z`)).toBeNull()
  })
  it('does not classify VOR-A as a STAR', () => {
    expect(airports.VTCC.procedures.filter((p) => p.kind === 'STAR').every((p) => p.type === 'GPS')).toBe(true)
  })
  it('recognizes canonical and verified endpoint aliases for every bundled STAR', () => {
    for (const airport of Object.values(airports)) for (const star of airport.procedures.filter((p) => p.kind === 'STAR')) {
      expect(resolveRegionalStar(airport, star.runway, star.name)?.id).toBe(star.id)
      const suffix = star.name.match(/\d[A-Z]$/)?.[0], entry = star.legs[0]?.fix
      if (suffix && entry?.startsWith(star.name.slice(0, -suffix.length))) {
        expect(resolveRegionalStar(airport, star.runway, `${entry} ${entry}${suffix}`)?.id).toBe(star.id)
      }
    }
  })
  it('uses actual waypoint coordinates even when stored leg distances are zero', () => {
    const timing = calculateRegionalTiming(airport, star, approach, profile).timing!
    expect(timing.distanceNm).toBeGreaterThan(10)
    expect(regionalDistanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(60.04, 1)
  })
  it('rejects contradictory altitude and aircraft speed constraints', () => {
    const badAltitude = { ...star, legs: star.legs.map((l, i) => ({ ...l, ...(i === 0 ? { altitudeType: '-', altitude1Ft: 1000 } : i === 1 ? { altitudeType: '+', altitude1Ft: 20000 } : {}) })) }
    expect(calculateRegionalTiming(airport, badAltitude, approach, profile).error).toMatch(/descending profile/)
    const badSpeed = { ...star, legs: star.legs.map((l, i) => i ? l : { ...l, speedType: '+', speedKt: 390 }) }
    expect(calculateRegionalTiming(airport, badSpeed, approach, profile).error).toMatch(/speed exceeds/)
  })
  it('honors altitude bounds at every published waypoint and does not introduce a climb', () => {
    const timing = calculateRegionalTiming(airport, star, approach, profile).timing!
    for (const s of timing.segments) {
      expect(s.endAltitudeFt).toBeLessThanOrEqual(s.startAltitudeFt + .01)
      const target = s.to
      if (target.altitudeType === '+') expect(s.endAltitudeFt).toBeGreaterThanOrEqual(target.altitude1Ft!)
      if (target.altitudeType === '-') expect(s.endAltitudeFt).toBeLessThanOrEqual(target.altitude1Ft!)
      if (target.altitudeType === 'A' && target.altitude1Ft! > 0) expect(s.endAltitudeFt).toBe(target.altitude1Ft)
      if (target.speedType === '-' && target.speedKt! > 0) expect(s.endIasKt).toBeLessThanOrEqual(target.speedKt!)
    }
  })
})
