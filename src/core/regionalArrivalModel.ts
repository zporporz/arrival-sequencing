import type { AircraftPerformanceProfile } from './api'

export type RegionalCode = 'VTCC' | 'VTSP'
export type NavLeg = {
  path: string; fix: string | null; lat: number | null; lon: number | null
  course: number | null; distanceNm: number | null; turn: string | null
  altitudeType: string | null; altitude1Ft: number | null; altitude2Ft: number | null
  speedType: string | null; speedKt: number | null
}
export type NavProcedure = {
  id: string; kind: string; name: string; type: string; runway: string
  legs: NavLeg[]; transitions: { name: string; legs: NavLeg[] }[]
}
export type RegionalRunway = {
  name: string; lat: number; lon: number; elevationFt: number; course: number; displacedThresholdFt: number
}
export type RegionalAirport = {
  code: RegionalCode; name: string; lat: number; lon: number; elevationFt: number
  runways: RegionalRunway[]; procedures: NavProcedure[]
}
export type RegionalNavPayload = { cycle: string; source: string; airport: RegionalAirport }
export type ModelSegment = {
  from: NavLeg; to: NavLeg; phase: 'STAR' | 'APPROACH'; distanceNm: number
  startAltitudeFt: number; endAltitudeFt: number; startIasKt: number; endIasKt: number
  seconds: number; cumulativeSeconds: number; cumulativeNm: number
}
export type RegionalTiming = {
  star: string; approach: string; transition: string | null; entry: NavLeg
  nominalSeconds: number; starSeconds: number; approachSeconds: number
  distanceNm: number; segments: ModelSegment[]; warnings: string[]
}
export type TimingResult = { timing: RegionalTiming; error?: never } | { timing?: never; error: string }
const rad = (value: number) => value * Math.PI / 180
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
const validPoint = (p: { lat: number | null; lon: number | null }) => p.lat != null && p.lon != null
  && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

export function regionalDistanceNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 6880.13 * Math.asin(Math.sqrt(clamp(h, 0, 1)))
}
function legDistance(a: NavLeg, b: NavLeg) {
  return regionalDistanceNm({ lat: a.lat!, lon: a.lon! }, { lat: b.lat!, lon: b.lon! })
}

export function resolveRegionalStar(airport: RegionalAirport, runway: string, route: string | null) {
  const ordered = (route || '').toUpperCase().split(/\s+/).map((t) => t.split('/')[0])
  const tokens = new Set(ordered)
  const stars = airport.procedures.filter((p) => p.kind === 'STAR' && p.runway === runway)
  const aliases = (p: NavProcedure) => {
    const suffix = p.name.match(/\d{1,2}[A-Z]?$/)?.[0]
    const names = new Set([p.name])
    if (suffix) {
      const stem = p.name.slice(0, -suffix.length)
      for (const fix of [p.legs[0]?.fix, ...p.transitions.map((t) => t.legs[0]?.fix)]) {
        if (!fix?.startsWith(stem)) continue
        names.add(`${fix}${suffix}`)
        if (stem === fix) names.add(`${fix.slice(0, 6 - suffix.length)}${suffix}`)
      }
    }
    return [...names]
  }
  const filed = (p: NavProcedure) => aliases(p).some((name) => tokens.has(name))
  const exact = stars.filter(filed)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  // Never silently replace an explicitly filed STAR with another runway's variant.
  if (airport.procedures.some((p) => p.kind === 'STAR' && filed(p))) return null
  const byEntry = stars.filter((p) => p.legs[0]?.fix && tokens.has(p.legs[0].fix))
  if (byEntry.length === 1 && ordered.slice(ordered.lastIndexOf(byEntry[0].legs[0].fix!) + 1)
    .some((token) => /^[A-Z]{3,5}\d[A-Z]$/.test(token))) return null
  return byEntry.length === 1 ? byEntry[0] : null
}

type Range = { lo: number; hi: number }
function altitudeBounds(leg: NavLeg): Range {
  const a = leg.altitude1Ft, b = leg.altitude2Ft
  if (!positive(a) && !positive(b)) return { lo: 0, hi: 45000 }
  if (leg.altitudeType === '+' && positive(a)) return { lo: a, hi: 45000 }
  if (leg.altitudeType === '-' && positive(a)) return { lo: 0, hi: a }
  if (leg.altitudeType === 'A' && positive(a)) return { lo: a, hi: a }
  if (leg.altitudeType === 'B' && positive(a) && positive(b)) return { lo: Math.min(a, b), hi: Math.max(a, b) }
  throw new Error(`Unsupported altitude constraint at ${leg.fix}`)
}
function speedBounds(leg: NavLeg): Range {
  if (!positive(leg.speedKt)) return { lo: 0, hi: 450 }
  if (leg.speedType === '-') return { lo: 0, hi: leg.speedKt }
  if (leg.speedType === '+') return { lo: leg.speedKt, hi: 450 }
  if (leg.speedType === null || leg.speedType === '' || leg.speedType === 'A') return { lo: leg.speedKt, hi: leg.speedKt }
  throw new Error(`Unsupported speed constraint at ${leg.fix}`)
}

// ISA approximation, not an atmospheric/wind forecast or full performance solver.
export function regionalTasKt(iasKt: number, altitudeFt: number) {
  const heightM = clamp(altitudeFt, 0, 36000) * 0.3048
  const temperatureRatio = 1 - 0.0065 * heightM / 288.15
  const densityRatio = temperatureRatio ** 4.25588
  return iasKt / Math.sqrt(densityRatio)
}
export function regionalScheduledIas(profile: AircraftPerformanceProfile, altitudeFt: number) {
  const tasAtMach = profile.descentMach * Math.sqrt(1.4 * 287.05287 * (288.15 - 0.0065 * clamp(altitudeFt, 0, 36000) * 0.3048)) * 1.943844
  const iasAtMach = tasAtMach / regionalTasKt(1, altitudeFt)
  return Math.min(altitudeFt <= 10000 ? profile.descentBelow10000IasKt : profile.descentIasKt, iasAtMach)
}
const FINAL_REFERENCE: Record<string, number> = { A: 90, B: 120, C: 140, D: 165, E: 210, H: 90 }

/** No VM/FM, holding, RF/AF arcs, or disconnected straight-line shortcuts are fabricated. */
export function calculateRegionalTiming(airport: RegionalAirport, star: NavProcedure, approach: NavProcedure,
  profile: AircraftPerformanceProfile | null, windAlongKt = 0): TimingResult {
  try {
    if (star.kind !== 'STAR' || approach.kind !== 'APPROACH' || star.runway !== approach.runway) throw new Error('STAR / approach runway mismatch')
    const runway = airport.runways.find((r) => r.name === star.runway)
    if (!runway) throw new Error('Runway geometry missing')
    if (!profile || !positive(profile.descentMach) || !positive(profile.descentIasKt) || !positive(profile.descentBelow10000IasKt)
      || !profile.performanceCategory || !FINAL_REFERENCE[profile.performanceCategory]) throw new Error('SimBrief descent profile / approach category unavailable')
    if (!Number.isFinite(windAlongKt) || Math.abs(windAlongKt) > 100) throw new Error('Invalid along-track wind assumption')
    const endpoint = star.legs.at(-1)
    if (!endpoint?.fix) throw new Error('STAR endpoint unavailable')
    if (star.legs.some((l) => !['IF', 'TF', 'CF'].includes(l.path))) throw new Error('Open STAR / unsupported leg: explicit vector or curved-path model required')
    const variants = [ { name: null as string | null, legs: approach.legs },
      ...approach.transitions.map((t) => ({ name: t.name, legs: [...t.legs, ...approach.legs] })) ]
    const connections = variants.flatMap((v) => {
      const index = v.legs.findIndex((l) => l.fix === endpoint.fix && validPoint(l) && validPoint(endpoint) && legDistance(l, endpoint) < 0.2)
      return index < 0 ? [] : [{ name: v.name, legs: v.legs.slice(index) }]
    })
    if (!connections.length) throw new Error('No published STAR → approach connection; select a connected approach')
    // If multiple transitions share an endpoint, their remaining path must agree.
    const signature = (legs: NavLeg[]) => legs.filter((l, i) => !i || l.fix !== legs[i - 1].fix)
      .map((l, i) => `${l.fix}:${i ? l.path : 'JOIN'}`).join('|')
    if (new Set(connections.map((c) => signature(c.legs))).size > 1) throw new Error('Ambiguous approach transition')
    const connection = connections[0]
    const legs = [...star.legs]
    const bounds = legs.map(altitudeBounds)
    const speeds = legs.map(speedBounds)
    const starLastIndex = legs.length - 1
    for (const leg of connection.legs) {
      const last = legs.at(-1)!
      if (leg.fix === last.fix && validPoint(leg) && validPoint(last) && legDistance(leg, last) < 0.01) {
        const alt = altitudeBounds(leg), speed = speedBounds(leg), index = legs.length - 1
        bounds[index] = { lo: Math.max(bounds[index].lo, alt.lo), hi: Math.min(bounds[index].hi, alt.hi) }
        speeds[index] = { lo: Math.max(speeds[index].lo, speed.lo), hi: Math.min(speeds[index].hi, speed.hi) }
      } else { legs.push(leg); bounds.push(altitudeBounds(leg)); speeds.push(speedBounds(leg)) }
    }
    if (legs.length < 3 || legs.some((l) => !validPoint(l))) throw new Error('Missing procedure coordinates')
    if (legs.some((l, i) => !['IF', 'TF', 'CF'].includes(l.path) || (i > 0 && l.path === 'IF'))) throw new Error('Unsupported path or discontinuity; timing not generated')
    // A MAP is not necessarily at the runway: do not invent a visual/circling segment.
    const finalDistance = regionalDistanceNm({ lat: legs.at(-1)!.lat!, lon: legs.at(-1)!.lon! }, runway)
    if (finalDistance > 0.25) throw new Error('Approach ends before the runway; final segment not available')
    if (bounds.some((b) => b.lo > b.hi) || speeds.some((b) => b.lo > b.hi)) throw new Error('Conflicting STAR / approach restrictions')
    const distances = legs.map((l, i) => i ? legDistance(legs[i - 1], l) : 0)
    if (distances.some((d) => d > 200)) throw new Error('Invalid procedure segment distance')
    const remaining = distances.map((_, i) => distances.slice(i + 1).reduce((sum, d) => sum + d, 0))
    // A preceding upper limit also limits later unconstrained fixes: allow level
    // flight instead of inventing a climb back onto a nominal three-degree line.
    for (let i = 1; i < bounds.length; i++) bounds[i].hi = Math.min(bounds[i].hi, bounds[i - 1].hi)
    for (let i = bounds.length - 2; i >= 0; i--) bounds[i].lo = Math.max(bounds[i].lo, bounds[i + 1].lo)
    if (bounds.some((b) => b.lo > b.hi)) throw new Error('No descending profile satisfies published altitude constraints')
    const altitudes = new Array<number>(legs.length)
    altitudes[legs.length - 1] = clamp(runway.elevationFt + 50, bounds.at(-1)!.lo, bounds.at(-1)!.hi)
    // Backward nominal 3-degree profile, constrained at every fix. Level portions allowed.
    for (let i = legs.length - 2; i >= 0; i--) {
      altitudes[i] = clamp(altitudes[i + 1] + distances[i + 1] * 318, bounds[i].lo, bounds[i].hi)
      if (altitudes[i] + 100 < altitudes[i + 1]) throw new Error(`No descending profile satisfies ${legs[i].fix} → ${legs[i + 1].fix}`)
    }
    const reference = FINAL_REFERENCE[profile.performanceCategory]
    const ias = legs.map((_, i) => {
      let scheduled = regionalScheduledIas(profile, altitudes[i])
      if (i >= starLastIndex) scheduled = Math.min(scheduled, reference + Math.min(70, Math.max(0, remaining[i] - 4) * 5))
      // Restrictions are point constraints, not speed commands for the entire STAR.
      return clamp(scheduled, speeds[i].lo, speeds[i].hi)
    })
    if (ias.some((speed) => speed < reference * 0.8 || speed > 400)) throw new Error('Speed restrictions incompatible with selected aircraft profile')
    if (ias.some((speed, i) => speed > regionalScheduledIas(profile, altitudes[i]) + .01)) throw new Error('Required speed exceeds the selected nominal SimBrief schedule')
    let seconds = 0, nm = 0, starSeconds = 0
    const segments: ModelSegment[] = []
    for (let i = 1; i < legs.length; i++) {
      let duration = 0
      const steps = Math.max(1, Math.ceil(distances[i]))
      for (let step = 0; step < steps; step++) {
        const f = (step + 0.5) / steps
        const height = altitudes[i - 1] + (altitudes[i] - altitudes[i - 1]) * f
        // Respect the lower-altitude speed schedule within a leg crossing 10,000 ft,
        // not just at its endpoints. Exact/minimum restrictions that exceed this
        // nominal schedule need a different aircraft/clearance model.
        const airspeed = Math.min(ias[i - 1] + (ias[i] - ias[i - 1]) * f, regionalScheduledIas(profile, height))
        const gs = Math.max(40, regionalTasKt(airspeed, height) + windAlongKt)
        duration += distances[i] / steps / gs * 3600
      }
      // Profiles supply speed schedules, not unrestricted descent performance.
      if (duration > 0 && (altitudes[i - 1] - altitudes[i]) / duration * 60 > 4500) throw new Error(`Descent feasibility needs review at ${legs[i].fix}`)
      seconds += duration; nm += distances[i]
      if (i <= starLastIndex) starSeconds += duration
      segments.push({ from: legs[i - 1], to: legs[i], phase: i <= starLastIndex ? 'STAR' : 'APPROACH',
        distanceNm: distances[i], startAltitudeFt: altitudes[i - 1], endAltitudeFt: altitudes[i],
        startIasKt: ias[i - 1], endIasKt: ias[i], seconds: duration, cumulativeSeconds: seconds, cumulativeNm: nm })
    }
    if (!(seconds > 0 && seconds < 3 * 3600)) throw new Error('Timing outside planning bounds')
    return { timing: { star: star.name, approach: approach.name, transition: connection.name, entry: legs[0],
      nominalSeconds: seconds, starSeconds, approachSeconds: seconds - starSeconds, distanceNm: nm, segments,
      warnings: ['EST: SimBrief speed schedule + ISA atmosphere + nominal descent; not a cleared trajectory',
        windAlongKt ? `Assumed along-track wind ${windAlongKt} kt` : 'No-wind planning estimate',
        'Fly-by turns / speed changes approximated; vector, holding and GA are not included'] } }
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
}
