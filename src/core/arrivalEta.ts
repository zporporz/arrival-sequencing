import type { IvaoArrivalTrafficFlight } from './api'

export type Coordinates = { lat: number; lon: number }

export type RoutePoint = {
  identifier: string
  type: string | null
  coordinates: Coordinates
}

export type RouteSegment = {
  from: RoutePoint
  to: RoutePoint
  distance: number
  bearing: number | null
  cumulativeDistance: number
}

export type RouteGeometry = {
  origin: string
  destination: string
  totalDistance: number | null
  segments: RouteSegment[]
  errors: Array<{ type: string; message: string }>
}

export type ArrivalEtaSource =
  | 'LIVE_ROUTE'
  | 'ACTUAL_DEPARTURE_EET'
  | 'TRACKED_TAKEOFF_EET'
  | 'FILED_EOBT_EET'
  | 'UNAVAILABLE'

export type ArrivalEtaEstimate = {
  source: ArrivalEtaSource
  predictedIawpAt: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  remainingNm: number | null
  offRouteNm: number | null
  groundSpeedKt: number | null
  pastCrossing: boolean
  reason: string | null
}

const MIN_LIVE_GS_KT = 80
const MAX_ROUTE_DEVIATION_NM = 100

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function safeTime(value: string | null | undefined) {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function utcDayStart(referenceMs: number) {
  const date = new Date(referenceMs)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Resolve IVAO seconds-of-day against the UTC day nearest a session/reference timestamp. */
export function secondsOfDayToNearestUtc(seconds: number, referenceIso: string) {
  const referenceMs = safeTime(referenceIso)
  if (referenceMs == null || !Number.isFinite(seconds) || seconds < 0) return null
  const normalizedSeconds = seconds % 86400
  const base = utcDayStart(referenceMs) + normalizedSeconds * 1000
  const candidates = [base - 86400000, base, base + 86400000]
  const best = candidates.sort((a, b) => Math.abs(a - referenceMs) - Math.abs(b - referenceMs))[0]
  return new Date(best).toISOString()
}

function segmentProjection(current: Coordinates, segment: RouteSegment) {
  const meanLat = ((current.lat + segment.from.coordinates.lat + segment.to.coordinates.lat) / 3) * Math.PI / 180
  const lonScale = 60 * Math.cos(meanLat)
  const ax = (segment.from.coordinates.lon - current.lon) * lonScale
  const ay = (segment.from.coordinates.lat - current.lat) * 60
  const bx = (segment.to.coordinates.lon - current.lon) * lonScale
  const by = (segment.to.coordinates.lat - current.lat) * 60
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const rawT = lengthSquared > 0 ? -(ax * dx + ay * dy) / lengthSquared : 0
  const t = Math.max(0, Math.min(1, rawT))
  const px = ax + t * dx
  const py = ay + t * dy
  return { t, distanceNm: Math.hypot(px, py) }
}

function routeProgress(flight: IvaoArrivalTrafficFlight, geometry: RouteGeometry) {
  if (!finite(flight.latitude) || !finite(flight.longitude)) return null
  const current = { lat: flight.latitude, lon: flight.longitude }
  let best: { progressNm: number; offRouteNm: number } | null = null

  for (const segment of geometry.segments) {
    if (!finite(segment.distance) || !finite(segment.cumulativeDistance)) continue
    const projected = segmentProjection(current, segment)
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    const progressNm = startDistance + projected.t * segment.distance
    if (!best || projected.distanceNm < best.offRouteNm) {
      best = { progressNm, offRouteNm: projected.distanceNm }
    }
  }
  return best
}

function fixDistances(geometry: RouteGeometry, fix: string) {
  const target = fix.trim().toUpperCase()
  const distances: number[] = []
  for (const segment of geometry.segments) {
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    if (segment.from.identifier.toUpperCase() === target) distances.push(startDistance)
    if (segment.to.identifier.toUpperCase() === target) distances.push(segment.cumulativeDistance)
  }
  return distances.sort((a, b) => a - b)
}

function liveRouteEstimate(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry,
  refFix: string,
  fetchedAt: string,
): ArrivalEtaEstimate | null {
  if (!finite(flight.groundSpeed) || flight.groundSpeed < MIN_LIVE_GS_KT) return null
  const progress = routeProgress(flight, geometry)
  if (!progress || progress.offRouteNm > MAX_ROUTE_DEVIATION_NM) return null

  const targets = fixDistances(geometry, refFix)
  if (!targets.length) return null

  const trackBaseMs = safeTime(flight.trackTimestamp) ?? safeTime(fetchedAt) ?? Date.now()
  const ahead = targets.find((distance) => distance >= progress.progressNm - 1)

  if (ahead != null) {
    const remainingNm = Math.max(0, ahead - progress.progressNm) + progress.offRouteNm
    const etaMs = trackBaseMs + remainingNm / flight.groundSpeed * 3600000
    return {
      source: 'LIVE_ROUTE',
      predictedIawpAt: new Date(etaMs).toISOString(),
      confidence: 'HIGH',
      remainingNm,
      offRouteNm: progress.offRouteNm,
      groundSpeedKt: flight.groundSpeed,
      pastCrossing: false,
      reason: null,
    }
  }

  const passed = targets.filter((distance) => distance < progress.progressNm - 1).at(-1)
  if (passed == null) return null
  const distanceSinceFix = Math.max(0, progress.progressNm - passed) + progress.offRouteNm
  const crossingMs = trackBaseMs - distanceSinceFix / flight.groundSpeed * 3600000
  return {
    source: 'LIVE_ROUTE',
    predictedIawpAt: new Date(crossingMs).toISOString(),
    confidence: 'MEDIUM',
    remainingNm: 0,
    offRouteNm: progress.offRouteNm,
    groundSpeedKt: flight.groundSpeed,
    pastCrossing: true,
    reason: 'IAWP already passed; crossing time back-estimated from current track',
  }
}

function eetEstimate(
  source: Exclude<ArrivalEtaSource, 'LIVE_ROUTE' | 'UNAVAILABLE'>,
  departureIso: string | null,
  filedEetSeconds: number | null,
  nominalStarSeconds: number,
): ArrivalEtaEstimate | null {
  const departureMs = safeTime(departureIso)
  if (departureMs == null || !finite(filedEetSeconds) || filedEetSeconds <= 0) return null
  const predictedIawpMs = departureMs + Math.max(0, filedEetSeconds - nominalStarSeconds) * 1000
  return {
    source,
    predictedIawpAt: new Date(predictedIawpMs).toISOString(),
    confidence: source === 'FILED_EOBT_EET' ? 'LOW' : 'MEDIUM',
    remainingNm: null,
    offRouteNm: null,
    groundSpeedKt: flightSafeGroundSpeed(null),
    pastCrossing: false,
    reason: source === 'FILED_EOBT_EET' ? 'Provisional filed-time estimate' : null,
  }
}

function flightSafeGroundSpeed(value: number | null) {
  return finite(value) ? value : null
}

/**
 * Progressive ETA source priority for the Approach AMAN:
 * live route/track -> actual departure + EET -> tracked takeoff + EET -> filed EOBT + EET.
 */
export function estimateIawpArrival(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  nominalStarSeconds: number,
  fetchedAt: string,
): ArrivalEtaEstimate {
  if (geometry) {
    const live = liveRouteEstimate(flight, geometry, refFix, fetchedAt)
    if (live) return live
  }

  const referenceIso = flight.connectedAt || fetchedAt
  const actualDepartureIso = flight.actualDepartureTimeSeconds != null && flight.onGround !== true
    ? secondsOfDayToNearestUtc(flight.actualDepartureTimeSeconds, referenceIso)
    : null
  const actual = eetEstimate('ACTUAL_DEPARTURE_EET', actualDepartureIso, flight.filedEetSeconds, nominalStarSeconds)
  if (actual) return actual

  const tracked = eetEstimate('TRACKED_TAKEOFF_EET', flight.trackedTakeoffAt, flight.filedEetSeconds, nominalStarSeconds)
  if (tracked) return tracked

  const filedDepartureIso = flight.filedDepartureTimeSeconds != null
    ? secondsOfDayToNearestUtc(flight.filedDepartureTimeSeconds, referenceIso)
    : null
  const filed = eetEstimate('FILED_EOBT_EET', filedDepartureIso, flight.filedEetSeconds, nominalStarSeconds)
  if (filed) return filed

  return {
    source: 'UNAVAILABLE',
    predictedIawpAt: null,
    confidence: 'NONE',
    remainingNm: null,
    offRouteNm: null,
    groundSpeedKt: flightSafeGroundSpeed(flight.groundSpeed),
    pastCrossing: false,
    reason: 'No usable live route or flight-plan timing source',
  }
}
