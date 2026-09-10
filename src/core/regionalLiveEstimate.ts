import type { AircraftPerformanceProfile, IvaoArrivalTrafficFlight } from './api'
import type { Coordinates, RouteGeometry } from './arrivalEtaLegacy'
import { regionalDistanceNm, regionalScheduledIas, regionalTasKt, type RegionalTiming } from './regionalArrivalModel'

export type RegionalLiveEstimate = {
  etaFfMs: number | null; tldtMs: number; pastEntry: boolean; remainingNm: number; offRouteNm: number
  basis: string
}
type Result = { estimate: RegionalLiveEstimate; error?: never } | { error: string; estimate?: never }
type PathSegment = { from: Coordinates; to: Coordinates; distanceNm: number; modelIndex: number | null }
const rad = (n: number) => n * Math.PI / 180
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const valid = (p: Coordinates | undefined): p is Coordinates => Boolean(p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
function project(point: Coordinates, segment: PathSegment) {
  const cos = Math.cos(rad(point.lat))
  const ax = (segment.from.lon - point.lon) * 60 * cos, ay = (segment.from.lat - point.lat) * 60
  const dx = (segment.to.lon - segment.from.lon) * 60 * cos, dy = (segment.to.lat - segment.from.lat) * 60
  const along = -(ax * dx + ay * dy) / Math.max(.000001, dx * dx + dy * dy)
  const f = clamp(along, 0, 1)
  return { f, along, off: Math.hypot(ax + f * dx, ay + f * dy), bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 }
}

/** Preview only: current position → remaining published path. No EOBT/EET fallback,
 * stage locks, shared commands, or invented past FF crossing timestamps. */
export function estimateRegionalLive(flight: IvaoArrivalTrafficFlight, timing: RegionalTiming,
  profile: AircraftPerformanceProfile, geometry: RouteGeometry | null, fetchedAt: string): Result {
  const point = { lat: flight.latitude!, lon: flight.longitude! }
  if (flight.latitude == null || flight.longitude == null || !valid(point)) return { error: 'Position unavailable' }
  if (flight.onGround === true) return { error: 'GROUND — waiting for airborne position; no locked ground estimate' }
  if (['landed', 'onblocks'].includes((flight.state || '').toLowerCase().replace(/ /g, ''))) return { error: 'Terminal phase — no arrival estimate' }
  if (flight.altitude == null || !Number.isFinite(flight.altitude) || flight.heading == null || !Number.isFinite(flight.heading)) return { error: 'Altitude / heading unavailable' }
  if (flight.groundSpeed == null || !Number.isFinite(flight.groundSpeed) || flight.groundSpeed < 60 || flight.groundSpeed > 800) return { error: 'Airborne groundspeed unavailable' }
  if (flight.onGround !== false && !['Initial Climb', 'En Route', 'Approach'].some((s) => s.toLowerCase().replace(/ /g, '') === (flight.state || '').toLowerCase().replace(/ /g, ''))) return { error: 'Airborne state not confirmed' }
  const asOf = Date.parse(fetchedAt), sample = Date.parse(flight.trackTimestamp || '')
  if (!Number.isFinite(asOf) || !Number.isFinite(sample) || asOf - sample > 90_000 || sample - asOf > 15_000) return { error: 'STALE — recent position required' }
  const entry = { lat: timing.entry.lat!, lon: timing.entry.lon! }
  const prefix: PathSegment[] = []
  // A partial path is independently re-parsed from the filed enroute section,
  // never made safe simply by ignoring warnings on the full route.
  const partial = geometry?.entryRoute
  const source = partial && partial.entryFix === timing.entry.fix && partial.cycle === geometry?.cycle ? partial : geometry
  // Use a resolved route only if it really reaches this entry fix. Never insert
  // direct-to-STAR from an arbitrary airborne position or mix parser errors in.
  if (source?.destination === flight.arrival && source.origin === flight.departure && !source.errors?.length) {
    let connected = false
    for (const s of source.segments) {
      if (!valid(s.from?.coordinates) || !valid(s.to?.coordinates)) break
      if (prefix.length && regionalDistanceNm(prefix.at(-1)!.to, s.from.coordinates) > .1) break
      if (s.from.identifier === timing.entry.fix && regionalDistanceNm(s.from.coordinates, entry) < .2) { connected = true; break }
      const distanceNm = regionalDistanceNm(s.from.coordinates, s.to.coordinates)
      if (distanceNm > 500) break
      if (distanceNm > .001) prefix.push({ from: s.from.coordinates, to: s.to.coordinates, distanceNm, modelIndex: null })
      if (s.to.identifier === timing.entry.fix && regionalDistanceNm(s.to.coordinates, entry) < .2) { connected = true; break }
    }
    if (!connected) prefix.length = 0
  }
  const path: PathSegment[] = [...prefix, ...timing.segments.map((s, index) => ({
    from: { lat: s.from.lat!, lon: s.from.lon! }, to: { lat: s.to.lat!, lon: s.to.lon! }, distanceNm: s.distanceNm, modelIndex: index,
  }))]
  const options = path.map((s, index) => ({ ...project(point, s), index }))
    .filter((p) => p.along >= 0 && p.along <= 1)
    .filter((p) => Math.abs(((p.bearing - flight.heading! + 540) % 360) - 180) <= 70)
    .sort((a, b) => a.off - b.off || b.index - a.index)
  const position = options[0]
  if (!position || position.off > 3) return { error: !prefix.length
    ? `Route to STAR entry unavailable — ${geometry?.entryRouteError || geometry?.errors?.[0]?.message || 'no connected upstream route'}`
    : 'Off published route / heading mismatch — no direct shortcut estimate' }
  if (options.some((p) => Math.abs(p.index - position.index) > 1 && p.off < position.off + .5)) return { error: 'Ambiguous route crossing — waiting for a clearer position' }
  const current = path[position.index]
  const currentDistance = current.distanceNm * (1 - position.f)
  const remainingNm = currentDistance + path.slice(position.index + 1).reduce((n, s) => n + s.distanceNm, 0)
  let etaFfMs: number | null = null, remainingSeconds: number
  if (current.modelIndex == null) {
    const toEntry = currentDistance + path.slice(position.index + 1, prefix.length).reduce((n, s) => n + s.distanceNm, 0)
    const entryAltitude = timing.segments[0].startAltitudeFt
    const descentNm = Math.max(0, flight.altitude - entryAltitude) / 318
    const steps = Math.max(1, Math.ceil(toEntry / 2))
    let seconds = 0
    for (let step = 0; step < steps; step++) {
      const remaining = toEntry * (1 - (step + .5) / steps)
      const altitude = Math.min(flight.altitude, entryAltitude + remaining * 318)
      const ias = regionalScheduledIas(profile, altitude)
      const gs = remaining > descentNm ? flight.groundSpeed : Math.min(flight.groundSpeed, regionalTasKt(ias, altitude))
      seconds += toEntry / steps / Math.max(60, gs) * 3600
    }
    etaFfMs = sample + seconds * 1000
    remainingSeconds = seconds + timing.nominalSeconds
  } else {
    const index = current.modelIndex, segment = timing.segments[index]
    const expectedAltitude = segment.startAltitudeFt + (segment.endAltitudeFt - segment.startAltitudeFt) * position.f
    if (Math.abs(flight.altitude - expectedAltitude) > 5000) return { error: 'Altitude far from nominal arrival profile — review required' }
    const endGs = regionalTasKt(segment.endIasKt, segment.endAltitudeFt)
    remainingSeconds = currentDistance / Math.max(60, (flight.groundSpeed + endGs) / 2) * 3600
      + timing.segments.slice(index + 1).reduce((n, s) => n + s.seconds, 0)
  }
  return { estimate: { etaFfMs, tldtMs: sample + remainingSeconds * 1000, pastEntry: current.modelIndex != null,
    remainingNm, offRouteNm: position.off,
    basis: 'EST · live position + published path + SimBrief · no wind / vector / holding / sequencing' } }
}
