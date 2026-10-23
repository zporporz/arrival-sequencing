import type { RegionalAirport, NavLeg, NavProcedure } from './regionalArrivalModel'

type Row = Record<string, unknown>
type Reader = (sql: string) => Row[]
export type AiracAirport = Omit<RegionalAirport, 'code'> & { code: string }
export const AIRAC_AIRPORTS = ['VTBD', 'VTBS', 'VTCC', 'VTSP'] as const
const str = (v: unknown) => String(v ?? '').trim().toUpperCase()
const num = (v: unknown) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
const runwayName = (v: unknown) => str(v).replace(/^(\d)([LRC]?)$/, '0$1$2')
function leg(row: Row): NavLeg {
  return {
    path: str(row.type), fix: str(row.fix_ident) || null,
    lat: num(row.fix_laty), lon: num(row.fix_lonx), course: num(row.course),
    distanceNm: num(row.distance), turn: str(row.turn_direction) || null,
    altitudeType: str(row.alt_descriptor) || null, altitude1Ft: num(row.altitude1), altitude2Ft: num(row.altitude2),
    speedType: str(row.speed_limit_type) || null, speedKt: num(row.speed_limit),
  }
}

// Coordinates, runway elevations and displacement are read from the same SQLite
// as the STARs. Never fill missing data from a different cycle's bundled package.
export function extractAiracAirports(read: Reader): Record<string, AiracAirport> {
  const output: Record<string, AiracAirport> = {}
  for (const code of AIRAC_AIRPORTS) {
    const airport = read(`SELECT * FROM airport WHERE upper(ident)='${code}'`)[0]
    if (!airport) throw new Error(`AIRAC airport missing: ${code}`)
    const id = Number(airport.airport_id)
    if (!Number.isSafeInteger(id)) throw new Error(`Invalid airport ID: ${code}`)
    const runways = read(`SELECT e.* FROM runway_end e JOIN runway r ON e.runway_end_id=r.primary_end_id OR e.runway_end_id=r.secondary_end_id WHERE r.airport_id=${id} ORDER BY e.name`)
      .filter(r => /^(\d{1,2})[LRC]?$/.test(str(r.name)))
      .map(r => ({ name: runwayName(r.name), lat: num(r.laty)!, lon: num(r.lonx)!,
        elevationFt: num(r.altitude) ?? num(airport.altitude)!, course: num(r.heading)!, displacedThresholdFt: num(r.offset_threshold)! }))
    const source = read(`SELECT * FROM approach WHERE airport_id=${id} ORDER BY approach_id`)
    const procedures: NavProcedure[] = []
    for (const proc of source) {
      const suffix = str(proc.suffix), type = str(proc.type)
      if (type === 'GPS' && suffix === 'D') continue
      const kind = type === 'GPS' && suffix === 'A' ? 'STAR' : 'APPROACH'
      const procId = Number(proc.approach_id)
      if (!Number.isSafeInteger(procId)) throw new Error(`Invalid procedure ID: ${code}`)
      const arinc = str(proc.arinc_name).replace(/^([A-Z]\d{2}[LRC]?)([A-Z])$/, '$1-$2')
      const name = kind === 'STAR' ? str(proc.fix_ident)
        : `${arinc}${suffix && !arinc.endsWith(`-${suffix}`) ? `-${suffix}` : ''}`
      if (!name) continue
      const common = read(`SELECT * FROM approach_leg WHERE approach_id=${procId} AND coalesce(is_missed,0)=0 ORDER BY approach_leg_id`).map(leg)
      const transitions = read(`SELECT * FROM transition WHERE approach_id=${procId} ORDER BY transition_id`).map(t => {
        const tid = Number(t.transition_id)
        if (!Number.isSafeInteger(tid)) throw new Error(`Invalid transition ID: ${code}`)
        return { name: str(t.fix_ident) || str(t.type), legs: read(`SELECT * FROM transition_leg WHERE transition_id=${tid} ORDER BY transition_leg_id`).map(leg) }
      })
      const assigned = runwayName(proc.runway_name)
      const ends = kind === 'STAR' && (!assigned || assigned === 'ALL') ? runways.map(r => r.name) : [assigned]
      for (const runway of ends) {
        if (!runways.some(r => r.name === runway)) continue // Circling-only procedures are not landing paths.
        procedures.push({ id: `${procId}:${runway}`, kind, name, type, runway, legs: common, transitions })
      }
    }
    output[code] = { code, name: String(airport.name || code), lat: num(airport.laty)!, lon: num(airport.lonx)!,
      elevationFt: num(airport.altitude)!, runways, procedures }
  }
  return output
}
