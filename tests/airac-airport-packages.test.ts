import { describe, expect, it, vi } from 'vitest'
vi.mock('../functions/_lib/supabaseAdmin.js', () => ({
  supabaseAdminRequest: (env: any, path: string, options: any) => env.AMAN_DATA.request(path, options),
}))
import final from '../functions/_data/final-approaches.json'
import regional from '../functions/_data/regional-arrivals.json'
import { extractAiracAirports } from '../src/core/airacAirportImport'
import { calculateRegionalTiming, type RegionalAirport } from '../src/core/regionalArrivalModel'
import { validateAiracAirports, activeAiracAirport } from '../functions/_lib/activeAiracAirports.js'
import { onRequestPost } from '../functions/api/admin/navdata.js'
import { activeFinalApproaches } from '../functions/_lib/finalApproaches.js'

const airports = { ...final.airports, ...regional.airports }
const sha = 'a'.repeat(64)
const cycle = { id: 'new-cycle', cycle: '2610', source_sha256: sha }
const packageRow = { details: { cycle: cycle.cycle, sourceSha256: sha, airports } }
const profile = { source: 'SIMBRIEF' as const, aircraftType: 'A320', aircraftName: 'A320',
  aircraftDefaultCruise: null, aircraftSpeed: null, performanceCategory: 'C' as const,
  descentProfile: '78/280/250', descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 }

function backend(existingPackage = true) {
  const writes: Array<{ path: string; body: any }> = []
  const env = { AMAN_DATA: { request: async (path: string, options: any = {}) => {
    if (options.method === 'POST') {
      writes.push({ path, body: JSON.parse(options.body) })
      return { data: path.startsWith('rpc/') ? cycle.id : [] }
    }
    if (path.startsWith('navdata_cycles?')) return { data: [cycle] }
    if (path.startsWith('navdata_events?')) return { data: existingPackage ? [packageRow] : [] }
    throw new Error(`Unexpected read ${path}`)
  } } }
  return { env, writes }
}
function admin(env: any, payload: object) {
  return onRequestPost({ env, data: { auth: { vid: '123', name: 'Staff' } }, request: new Request('https://test/api/admin/navdata', {
    method: 'POST', body: JSON.stringify(payload),
  }) })
}

describe('one database AIRAC package for all operational airports', () => {
  it('validates all four airports and rejects incomplete geometry before staging', () => {
    expect(Object.keys(validateAiracAirports(airports))).toHaveLength(4)
    const broken = structuredClone(airports)
    broken.VTCC.procedures = broken.VTCC.procedures.filter(p => p.kind !== 'APPROACH')
    expect(() => validateAiracAirports(broken)).toThrow(/VTCC/)
    const badRunway = structuredClone(airports)
    badRunway.VTSP.runways[0].lat = NaN
    expect(() => validateAiracAirports(badRunway)).toThrow(/runway/)
  })
  it.each(['VTBD', 'VTBS', 'VTCC', 'VTSP'])('serves %s from 2610 without rebuilding any bundled JSON', async code => {
    const { env, writes } = backend()
    const value = await activeAiracAirport(env, code)
    expect(value.cycle).toBe('2610')
    expect(value.airport.code).toBe(code)
    expect((await activeFinalApproaches(env, code)).cycle).toBe('2610')
    expect(writes).toEqual([])
  })
  it('rejects absent/mismatched packages and does not activate a partial import', async () => {
    const { env, writes } = backend(false)
    const result = await admin(env, { action: 'activate', cycleId: cycle.id })
    expect(result.status).toBe(400)
    expect(await result.text()).toContain('same SQLite')
    expect(writes).toEqual([])
    const mismatched = { AMAN_DATA: { request: async (path: string) => ({ data: path.startsWith('navdata_cycles')
      ? [cycle] : [{ details: { ...packageRow.details, sourceSha256: 'b'.repeat(64) } }] }) } }
    await expect(activeAiracAirport(mismatched, 'VTCC')).rejects.toThrow(/source mismatch/)
  })
  it('completes an existing cycle from the same SQLite without replacing STAR data or timing settings', async () => {
    const { env, writes } = backend(false)
    const result = await admin(env, { action: 'import', meta: { cycle: '2610', sourceSha256: sha },
      airportPackages: airports, procedures: [{}], transitions: [], legs: [] })
    expect(result.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe('navdata_events')
    expect(writes[0].body).toMatchObject({ cycle_id: cycle.id, action: 'AIRAC_PACKAGE', details: { sourceSha256: sha } })
  })
  it('activates only after validating the same-cycle package', async () => {
    const { env, writes } = backend()
    expect((await admin(env, { action: 'activate', cycleId: cycle.id })).status).toBe(200)
    expect(writes.map(w => w.path)).toEqual(['rpc/activate_navdata_cycle'])
  })
  it('rejects incomplete new imports before making any writes', async () => {
    const { env, writes } = backend(false)
    const result = await admin(env, { action: 'import', meta: { cycle: '2610', sourceSha256: sha },
      airportPackages: { VTCC: airports.VTCC }, procedures: [{}], transitions: [], legs: [] })
    expect(result.status).toBe(400)
    expect(writes).toEqual([])
  })
  it('stages a new cycle before storing its package and makes repeated completion idempotent', async () => {
    const db = backend(false)
    const underlying = db.env.AMAN_DATA.request
    db.env.AMAN_DATA.request = async (path: string, options: any = {}) => path.includes('source_sha256=eq.')
      ? { data: [] } : underlying(path, options)
    const payload = { action: 'import', meta: { cycle: '2610', sourceSha256: sha },
      airportPackages: airports, procedures: [{}], transitions: [], legs: [] }
    expect((await admin(db.env, payload)).status).toBe(200)
    expect(db.writes.map(w => w.path)).toEqual(['rpc/import_navdata_cycle', 'navdata_events'])
    const complete = backend()
    expect((await admin(complete.env, payload)).status).toBe(200)
    expect(complete.writes).toEqual([])
  })
  it('checks active cycle every read, even with cached geometry', async () => {
    let current = { ...cycle }
    const env = { AMAN_DATA: { request: async (path: string) => ({ data: path.startsWith('navdata_cycles')
      ? [current] : [{ details: { ...packageRow.details, cycle: current.cycle } }] }) } }
    expect((await activeAiracAirport(env, 'VTCC')).cycle).toBe('2610')
    current = { ...cycle, id: 'next-cycle', cycle: '2611' }
    expect((await activeAiracAirport(env, 'VTCC')).cycle).toBe('2611')
  })
})

// Reconstruct SQLite-shaped rows from the published fixture, then compare the
// new extraction against the existing timing model without changing its formulas.
describe('SQLite airport extraction preserves regional timing', () => {
  it('keeps STAR/Approach/transition geometry, constraints and runway displacement', () => {
    const common = new Map<number, any[]>(), transitions = new Map<number, any[]>(), tlegs = new Map<number, any[]>()
    const source: Record<string, any[]> = {}
    let pid = 1, tid = 1
    const rawLeg = (l: any) => ({ type: l.path, fix_ident: l.fix, fix_laty: l.lat, fix_lonx: l.lon,
      course: l.course, distance: l.distanceNm, turn_direction: l.turn, alt_descriptor: l.altitudeType,
      altitude1: l.altitude1Ft, altitude2: l.altitude2Ft, speed_limit_type: l.speedType, speed_limit: l.speedKt })
    for (const [code, a] of Object.entries(airports)) {
      source[code] = a.procedures.map(p => {
        const id = pid++
        common.set(id, p.legs.map(rawLeg))
        transitions.set(id, p.transitions.map(t => {
          const idt = tid++
          tlegs.set(idt, t.legs.map(rawLeg))
          return { transition_id: idt, fix_ident: t.name }
        }))
        return { approach_id: id, type: p.type, suffix: p.kind === 'STAR' ? 'A' : null,
          fix_ident: p.kind === 'STAR' ? p.name : null, arinc_name: p.kind === 'APPROACH' ? p.name : null, runway_name: p.runway }
      })
    }
    const codes = Object.keys(airports) as Array<keyof typeof airports>
    const extracted = extractAiracAirports(sql => {
      if (sql.startsWith('SELECT * FROM airport ')) {
        const code = sql.match(/='(VT\w+)'/)![1] as keyof typeof airports, a = airports[code]
        return [{ airport_id: codes.indexOf(code), name: a.name, laty: a.lat, lonx: a.lon, altitude: a.elevationFt }]
      }
      const id = Number(sql.match(/(?:airport_id|approach_id|transition_id)=(\d+)/)![1])
      if (sql.includes('FROM runway_end')) return airports[codes[id]].runways.map(r => ({ name: r.name,
        laty: r.lat, lonx: r.lon, altitude: r.elevationFt, heading: r.course, offset_threshold: r.displacedThresholdFt }))
      if (sql.includes('FROM approach_leg')) return common.get(id)!
      if (sql.includes('FROM transition_leg')) return tlegs.get(id)!
      if (sql.includes('FROM transition ')) return transitions.get(id)!
      return source[codes[id]]
    })
    expect(Object.keys(validateAiracAirports(extracted))).toHaveLength(4)
    for (const code of ['VTCC', 'VTSP'] as const) {
      const old = airports[code] as unknown as RegionalAirport
      const fresh = extracted[code] as RegionalAirport
      expect(fresh.runways).toEqual(old.runways)
      for (const star of old.procedures.filter(p => p.kind === 'STAR')) {
        const preferred: Record<string, string> = { 'VTCC:18': 'R18', 'VTCC:36': 'I36-Z', 'VTSP:09': 'R09-Y', 'VTSP:27': 'I27' }
        const approach = old.procedures.find(p => p.kind === 'APPROACH' && p.name === preferred[`${code}:${star.runway}`])!
        const nextStar = fresh.procedures.find(p => p.name === star.name && p.runway === star.runway && p.kind === 'STAR')!
        const nextApproach = fresh.procedures.find(p => p.name === approach.name && p.runway === approach.runway && p.kind === 'APPROACH')!
        const before = calculateRegionalTiming(old, star, approach, profile)
        const after = calculateRegionalTiming(fresh, nextStar, nextApproach, profile)
        expect(after).toEqual(before)
      }
    }
  })
})
