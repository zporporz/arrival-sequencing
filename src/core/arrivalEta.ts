import { readAircraftPerformance, type AircraftPerformanceProfile, type IvaoArrivalTrafficFlight } from './api'

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
  modelPhase?: 'CRUISE' | 'DESCENT' | 'FALLBACK'
  trackSampleCount?: number
  verticalTrendFpm?: number | null
}

type TrackSample = {
  timestampMs: number
  altitudeFt: number | null
  groundSpeedKt: number | null
}

type TrackTrend = {
  samples: TrackSample[]
  sampleCount: number
  windowSeconds: number
  smoothedGroundSpeedKt: number | null
  verticalTrendFpm: number | null
}

const MIN_LIVE_GS_KT = 80
const MAX_ROUTE_DEVIATION_NM = 100
const POSITION_MODEL_MAX_TRIGGER_ALTITUDE_FT = 30000
const DESCENT_LOW_ALTITUDE_FT = 10000
const DESCENT_VS_THRESHOLD_FPM = -300
const TRACK_HISTORY_WINDOW_MS = 2 * 60 * 1000
const TRACK_HISTORY_MAX_KEYS = 500
const DESCENT_INTEGRATION_STEP_NM = 3
const FALLBACK_DESCENT_MACH = 0.78
const FALLBACK_DESCENT_IAS_KT = 280
const FALLBACK_LOW_DESCENT_IAS_KT = 250
const performanceCache = new Map<string, AircraftPerformanceProfile | null>()
const performanceRequests = new Map<string, Promise<void>>()
const trackHistory = new Map<string, TrackSample[]>()

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function safeTime(value: string | null | undefined) {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function normalizeAircraftType(value: string | null | undefined) {
  const type = String(value || '').trim().toUpperCase().split(/[\s/]/)[0]
  return /^[A-Z0-9]{2,8}$/.test(type) ? type : null
}

function cachedPerformance(flight: IvaoArrivalTrafficFlight) {
  const type = normalizeAircraftType(flight.aircraft)
  if (!type) return null
  if (performanceCache.has(type)) return performanceCache.get(type) ?? null

  if (!performanceRequests.has(type)) {
    const request = readAircraftPerformance(type)
      .then((payload) => {
        performanceCache.set(type, payload.found && payload.profile ? payload.profile : null)
      })
      .catch(() => {
        performanceCache.set(type, null)
      })
      .finally(() => {
        performanceRequests.delete(type)
      })
    performanceRequests.set(type, request)
  }
  return null
}

function historyKey(flight: IvaoArrivalTrafficFlight) {
  return String(flight.sessionId || flight.callsign || '').trim().toUpperCase()
}

function median(values: number[]) {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle]
}

function weightedGroundSpeed(samples: TrackSample[]) {
  const speedSamples = samples.filter((sample) => finite(sample.groundSpeedKt) && sample.groundSpeedKt >= MIN_LIVE_GS_KT && sample.groundSpeedKt <= 750)
  if (!speedSamples.length) return null

  const center = median(speedSamples.map((sample) => Number(sample.groundSpeedKt)))
  if (center == null) return null
  const tolerance = Math.max(30, center * 0.16)
  const filtered = speedSamples.filter((sample) => Math.abs(Number(sample.groundSpeedKt) - center) <= tolerance)
  const source = filtered.length ? filtered : speedSamples
  const firstMs = source[0].timestampMs
  const lastMs = source.at(-1)?.timestampMs ?? firstMs
  const spanMs = Math.max(1, lastMs - firstMs)

  let weightedTotal = 0
  let totalWeight = 0
  source.forEach((sample) => {
    const recency = (sample.timestampMs - firstMs) / spanMs
    const weight = 1 + recency * 2
    weightedTotal += Number(sample.groundSpeedKt) * weight
    totalWeight += weight
  })
  return totalWeight > 0 ? weightedTotal / totalWeight : center
}

function linearAltitudeTrendFpm(samples: TrackSample[]) {
  const altitudeSamples = samples.filter((sample): sample is TrackSample & { altitudeFt: number } => finite(sample.altitudeFt))
  if (altitudeSamples.length < 3) return null
  const firstMs = altitudeSamples[0].timestampMs
  const lastMs = altitudeSamples.at(-1)?.timestampMs ?? firstMs
  if (lastMs - firstMs < 30_000) return null

  const timesMinutes = altitudeSamples.map((sample) => (sample.timestampMs - firstMs) / 60_000)
  const meanTime = timesMinutes.reduce((sum, value) => sum + value, 0) / timesMinutes.length
  const meanAltitude = altitudeSamples.reduce((sum, sample) => sum + sample.altitudeFt, 0) / altitudeSamples.length
  let numerator = 0
  let denominator = 0

  altitudeSamples.forEach((sample, index) => {
    const timeDelta = timesMinutes[index] - meanTime
    numerator += timeDelta * (sample.altitudeFt - meanAltitude)
    denominator += timeDelta * timeDelta
  })
  return denominator > 0 ? numerator / denominator : null
}

function trimTrackHistory() {
  while (trackHistory.size > TRACK_HISTORY_MAX_KEYS) {
    const firstKey = trackHistory.keys().next().value
    if (firstKey == null) return
    trackHistory.delete(firstKey)
  }
}

function recordTrackTrend(flight: IvaoArrivalTrafficFlight, fetchedAt: string): TrackTrend {
  const key = historyKey(flight)
  const timestampMs = safeTime(flight.trackTimestamp) ?? safeTime(fetchedAt) ?? Date.now()
  const existing = key ? trackHistory.get(key) ?? [] : []
  const nextSample: TrackSample = {
    timestampMs,
    altitudeFt: finite(flight.altitude) ? flight.altitude : null,
    groundSpeedKt: finite(flight.groundSpeed) ? flight.groundSpeed : null,
  }

  const deduplicated = existing.filter((sample) => sample.timestampMs !== timestampMs)
  deduplicated.push(nextSample)
  deduplicated.sort((left, right) => left.timestampMs - right.timestampMs)
  const cutoff = timestampMs - TRACK_HISTORY_WINDOW_MS
  const samples = deduplicated.filter((sample) => sample.timestampMs >= cutoff && sample.timestampMs <= timestampMs + 1000)

  if (key) {
    trackHistory.set(key, samples)
    trimTrackHistory()
  }

  const firstMs = samples[0]?.timestampMs ?? timestampMs
  const lastMs = samples.at(-1)?.timestampMs ?? timestampMs
  return {
    samples,
    sampleCount: samples.length,
    windowSeconds: Math.max(0, Math.round((lastMs - firstMs) / 1000)),
    smoothedGroundSpeedKt: weightedGroundSpeed(samples),
    verticalTrendFpm: linearAltitudeTrendFpm(samples),
  }
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

function positionModelTriggerAltitudeFt(flight: IvaoArrivalTrafficFlight) {
  const filedCruise = finite(flight.filedCruiseAltitudeFt) && flight.filedCruiseAltitudeFt > 0
    ? flight.filedCruiseAltitudeFt
    : null
  return filedCruise == null
    ? POSITION_MODEL_MAX_TRIGGER_ALTITUDE_FT
    : Math.min(POSITION_MODEL_MAX_TRIGGER_ALTITUDE_FT, filedCruise)
}

function resolvedVerticalTrendFpm(flight: IvaoArrivalTrafficFlight, trend: TrackTrend) {
  const direct = finite(flight.verticalSpeedFpm) && Math.abs(flight.verticalSpeedFpm) <= 8000
    ? flight.verticalSpeedFpm
    : null
  const derived = finite(trend.verticalTrendFpm) && Math.abs(trend.verticalTrendFpm) <= 8000
    ? trend.verticalTrendFpm
    : null

  if (derived != null && trend.sampleCount >= 3 && trend.windowSeconds >= 30) {
    if (direct != null && Math.sign(direct) === Math.sign(derived)) return derived * 0.75 + direct * 0.25
    return derived
  }
  return direct
}

function isDescending(flight: IvaoArrivalTrafficFlight, trend: TrackTrend) {
  const state = String(flight.state || '').trim().toLowerCase()
  if (state === 'approach') return true
  const verticalTrend = resolvedVerticalTrendFpm(flight, trend)
  return verticalTrend != null && verticalTrend <= DESCENT_VS_THRESHOLD_FPM
}

function positionModelActive(flight: IvaoArrivalTrafficFlight, trend: TrackTrend) {
  if (flight.onGround === true || !finite(flight.altitude)) return false
  if (isDescending(flight, trend)) return true

  const state = String(flight.state || '').trim().toLowerCase()
  const filedCruise = finite(flight.filedCruiseAltitudeFt) && flight.filedCruiseAltitudeFt > 0
  if (!filedCruise && state === 'en route') return true

  const stableLevel = trend.sampleCount >= 3
    && trend.windowSeconds >= 45
    && finite(trend.verticalTrendFpm)
    && Math.abs(trend.verticalTrendFpm) < 250
  if (!filedCruise && stableLevel && flight.altitude >= 5000) return true

  return flight.altitude >= positionModelTriggerAltitudeFt(flight) - 500
}

function climbProtectionActive(flight: IvaoArrivalTrafficFlight, trend: TrackTrend) {
  if (flight.onGround === true || !finite(flight.altitude)) return false
  if (isDescending(flight, trend)) return false
  return flight.altitude < positionModelTriggerAltitudeFt(flight) - 500
}

function observedGroundSpeedKt(flight: IvaoArrivalTrafficFlight, trend: TrackTrend) {
  if (finite(trend.smoothedGroundSpeedKt) && trend.smoothedGroundSpeedKt >= MIN_LIVE_GS_KT) {
    const current = finite(flight.groundSpeed) && flight.groundSpeed >= MIN_LIVE_GS_KT ? flight.groundSpeed : trend.smoothedGroundSpeedKt
    return trend.smoothedGroundSpeedKt * 0.8 + current * 0.2
  }
  return finite(flight.groundSpeed) && flight.groundSpeed >= MIN_LIVE_GS_KT ? flight.groundSpeed : null
}

function isaState(altitudeFt: number) {
  const altitudeM = clamp(altitudeFt, 0, 45_000) * 0.3048
  const seaLevelTemperatureK = 288.15
  const lapseRateKPerM = 0.0065
  const troposphereTopM = 11_000
  const gasConstant = 287.05287
  const gravity = 9.80665

  if (altitudeM <= troposphereTopM) {
    const temperatureK = seaLevelTemperatureK - lapseRateKPerM * altitudeM
    const pressureRatio = Math.pow(temperatureK / seaLevelTemperatureK, gravity / (gasConstant * lapseRateKPerM))
    const densityRatio = pressureRatio / (temperatureK / seaLevelTemperatureK)
    return { temperatureK, densityRatio }
  }

  const tropopauseTemperatureK = seaLevelTemperatureK - lapseRateKPerM * troposphereTopM
  const tropopausePressureRatio = Math.pow(tropopauseTemperatureK / seaLevelTemperatureK, gravity / (gasConstant * lapseRateKPerM))
  const pressureRatio = tropopausePressureRatio * Math.exp(-gravity * (altitudeM - troposphereTopM) / (gasConstant * tropopauseTemperatureK))
  const densityRatio = pressureRatio / (tropopauseTemperatureK / seaLevelTemperatureK)
  return { temperatureK: tropopauseTemperatureK, densityRatio }
}

function iasToTasKt(iasKt: number, altitudeFt: number) {
  const { densityRatio } = isaState(altitudeFt)
  return iasKt / Math.sqrt(Math.max(0.05, densityRatio))
}

function machToTasKt(mach: number, altitudeFt: number) {
  const { temperatureK } = isaState(altitudeFt)
  const speedOfSoundKt = Math.sqrt(1.4 * 287.05287 * temperatureK) * 1.943844
  return mach * speedOfSoundKt
}

function profileValues(performance: AircraftPerformanceProfile | null) {
  return {
    mach: performance?.descentMach ?? FALLBACK_DESCENT_MACH,
    descentIasKt: performance?.descentIasKt ?? FALLBACK_DESCENT_IAS_KT,
    lowIasKt: performance?.descentBelow10000IasKt ?? FALLBACK_LOW_DESCENT_IAS_KT,
    label: performance?.descentProfile ?? `${Math.round(FALLBACK_DESCENT_MACH * 100)}/${FALLBACK_DESCENT_IAS_KT}/${FALLBACK_LOW_DESCENT_IAS_KT}`,
  }
}

function scheduledDescentTasKt(altitudeFt: number, performance: AircraftPerformanceProfile | null) {
  const profile = profileValues(performance)
  if (altitudeFt <= DESCENT_LOW_ALTITUDE_FT) return iasToTasKt(profile.lowIasKt, altitudeFt)

  const iasTas = iasToTasKt(profile.descentIasKt, altitudeFt)
  const machTas = machToTasKt(profile.mach, altitudeFt)
  return Math.min(iasTas, machTas)
}

function descentTravelSeconds(
  remainingNm: number,
  altitudeFt: number,
  observedGsKt: number,
  verticalTrendFpm: number | null,
  performance: AircraftPerformanceProfile | null,
) {
  if (remainingNm <= 0) return { seconds: 0, averageGroundSpeedKt: observedGsKt }

  const currentScheduleTas = scheduledDescentTasKt(altitudeFt, performance)
  const liveCorrectionKt = clamp(observedGsKt - currentScheduleTas, -120, 120)
  const descentRateFpm = clamp(Math.abs(verticalTrendFpm ?? -1500), 500, 4000)
  let distanceLeftNm = remainingNm
  let simulatedAltitudeFt = Math.max(0, altitudeFt)
  let elapsedSeconds = 0

  while (distanceLeftNm > 0.001 && elapsedSeconds < 4 * 60 * 60) {
    const stepNm = Math.min(DESCENT_INTEGRATION_STEP_NM, distanceLeftNm)
    const scheduledGsKt = clamp(scheduledDescentTasKt(simulatedAltitudeFt, performance) + liveCorrectionKt * 0.85, 90, 650)
    const liveWeight = clamp(0.72 - elapsedSeconds / 1800, 0.25, 0.72)
    const segmentGsKt = clamp(observedGsKt * liveWeight + scheduledGsKt * (1 - liveWeight), 90, 650)
    const segmentSeconds = stepNm / segmentGsKt * 3600
    elapsedSeconds += segmentSeconds
    simulatedAltitudeFt = Math.max(0, simulatedAltitudeFt - descentRateFpm * segmentSeconds / 60)
    distanceLeftNm -= stepNm
  }

  return {
    seconds: elapsedSeconds,
    averageGroundSpeedKt: elapsedSeconds > 0 ? remainingNm / (elapsedSeconds / 3600) : observedGsKt,
  }
}

function liveRouteEstimate(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry,
  refFix: string,
  fetchedAt: string,
  performance: AircraftPerformanceProfile | null,
  trend: TrackTrend,
): ArrivalEtaEstimate | null {
  if (!positionModelActive(flight, trend)) return null

  const observedGsKt = observedGroundSpeedKt(flight, trend)
  if (!finite(observedGsKt) || observedGsKt < MIN_LIVE_GS_KT) return null

  const progress = routeProgress(flight, geometry)
  if (!progress || progress.offRouteNm > MAX_ROUTE_DEVIATION_NM) return null

  const targets = fixDistances(geometry, refFix)
  if (!targets.length) return null

  const trackBaseMs = safeTime(flight.trackTimestamp) ?? safeTime(fetchedAt) ?? Date.now()
  const ahead = targets.find((distance) => distance >= progress.progressNm - 1)
  const verticalTrendFpm = resolvedVerticalTrendFpm(flight, trend)
  const descending = isDescending(flight, trend)

  if (ahead != null) {
    const remainingNm = Math.max(0, ahead - progress.progressNm) + progress.offRouteNm
    const travel = descending && finite(flight.altitude)
      ? descentTravelSeconds(remainingNm, flight.altitude, observedGsKt, verticalTrendFpm, performance)
      : {
          seconds: remainingNm / observedGsKt * 3600,
          averageGroundSpeedKt: observedGsKt,
        }
    const etaMs = trackBaseMs + travel.seconds * 1000
    const triggerFt = positionModelTriggerAltitudeFt(flight)
    const confidence = trend.sampleCount >= 3 && trend.windowSeconds >= 30 && progress.offRouteNm <= 25
      ? 'HIGH'
      : 'MEDIUM'
    const diagnostic = `ETA DBG ${descending ? 'DESCENT' : 'CRUISE'} · REM ${remainingNm.toFixed(1)}NM · OFF ${progress.offRouteNm.toFixed(1)}NM · OBS ${Math.round(observedGsKt)}KT · AVG ${Math.round(travel.averageGroundSpeedKt)}KT · VS ${verticalTrendFpm == null ? 'NA' : Math.round(verticalTrendFpm)} · SAMPLES ${trend.sampleCount}/${trend.windowSeconds}s`
    const modelReason = descending
      ? `Segmented descent ETA uses ${profileValues(performance).label}`
      : triggerFt < POSITION_MODEL_MAX_TRIGGER_ALTITUDE_FT
        ? `Position/route ETA active from filed cruise ${Math.round(triggerFt / 100)}00 ft`
        : trend.sampleCount >= 2
          ? 'Position/route ETA uses live GS trend'
          : 'Position/route ETA active'

    return {
      source: 'LIVE_ROUTE',
      predictedIawpAt: new Date(etaMs).toISOString(),
      confidence,
      remainingNm,
      offRouteNm: progress.offRouteNm,
      groundSpeedKt: travel.averageGroundSpeedKt,
      pastCrossing: false,
      reason: `${diagnostic} · ${modelReason}`,
      modelPhase: descending ? 'DESCENT' : 'CRUISE',
      trackSampleCount: trend.sampleCount,
      verticalTrendFpm,
    }
  }

  const passed = targets.filter((distance) => distance < progress.progressNm - 1).at(-1)
  if (passed == null) return null
  const distanceSinceFix = Math.max(0, progress.progressNm - passed) + progress.offRouteNm
  const crossingMs = trackBaseMs - distanceSinceFix / observedGsKt * 3600_000
  return {
    source: 'LIVE_ROUTE',
    predictedIawpAt: new Date(crossingMs).toISOString(),
    confidence: trend.sampleCount >= 3 ? 'HIGH' : 'MEDIUM',
    remainingNm: 0,
    offRouteNm: progress.offRouteNm,
    groundSpeedKt: observedGsKt,
    pastCrossing: true,
    reason: `ETA DBG PASSED · SINCE ${distanceSinceFix.toFixed(1)}NM · OFF ${progress.offRouteNm.toFixed(1)}NM · OBS ${Math.round(observedGsKt)}KT · SAMPLES ${trend.sampleCount}/${trend.windowSeconds}s · IAWP crossing back-estimated`,
    modelPhase: descending ? 'DESCENT' : 'CRUISE',
    trackSampleCount: trend.sampleCount,
    verticalTrendFpm,
  }
}

function provisionalClimbLiveEstimate(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry,
  refFix: string,
  fetchedAt: string,
  trend: TrackTrend,
): ArrivalEtaEstimate | null {
  if (flight.onGround === true || !finite(flight.altitude)) return null

  const observedGsKt = observedGroundSpeedKt(flight, trend)
  if (!finite(observedGsKt) || observedGsKt < MIN_LIVE_GS_KT) return null

  const progress = routeProgress(flight, geometry)
  if (!progress || progress.offRouteNm > MAX_ROUTE_DEVIATION_NM) return null

  const targets = fixDistances(geometry, refFix)
  if (!targets.length) return null

  const ahead = targets.find((distance) => distance >= progress.progressNm - 1)
  if (ahead == null) return null

  const remainingNm = Math.max(0, ahead - progress.progressNm) + progress.offRouteNm
  const trackBaseMs = safeTime(flight.trackTimestamp) ?? safeTime(fetchedAt) ?? Date.now()
  const etaMs = trackBaseMs + remainingNm / observedGsKt * 3600_000
  const triggerFt = positionModelTriggerAltitudeFt(flight)

  return {
    source: 'LIVE_ROUTE',
    predictedIawpAt: new Date(etaMs).toISOString(),
    confidence: 'MEDIUM',
    remainingNm,
    offRouteNm: progress.offRouteNm,
    groundSpeedKt: observedGsKt,
    pastCrossing: false,
    reason: `CLIMB PROVISIONAL · REM ${remainingNm.toFixed(1)}NM · OBS ${Math.round(observedGsKt)}KT · ALT ${Math.round(flight.altitude)}FT · LIVE unrestricted at ${Math.round(triggerFt / 100)}00FT`,
    modelPhase: 'CRUISE',
    trackSampleCount: trend.sampleCount,
    verticalTrendFpm: resolvedVerticalTrendFpm(flight, trend),
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
    groundSpeedKt: null,
    pastCrossing: false,
    reason: `ETA DBG FALLBACK ${source} · EET ${(filedEetSeconds / 60).toFixed(1)}MIN · STAR ${(nominalStarSeconds / 60).toFixed(1)}MIN`,
    modelPhase: 'FALLBACK',
  }
}

function takeoffBaselineEstimate(
  flight: IvaoArrivalTrafficFlight,
  nominalStarSeconds: number,
  referenceIso: string,
) {
  const actualDepartureIso = flight.actualDepartureTimeSeconds != null && flight.onGround !== true
    ? secondsOfDayToNearestUtc(flight.actualDepartureTimeSeconds, referenceIso)
    : null
  const actual = eetEstimate('ACTUAL_DEPARTURE_EET', actualDepartureIso, flight.filedEetSeconds, nominalStarSeconds)
  if (actual) return actual
  return eetEstimate('TRACKED_TAKEOFF_EET', flight.trackedTakeoffAt, flight.filedEetSeconds, nominalStarSeconds)
}

function protectedClimbEstimate(baseline: ArrivalEtaEstimate, provisional: ArrivalEtaEstimate | null) {
  const baselineMs = safeTime(baseline.predictedIawpAt)
  const provisionalMs = safeTime(provisional?.predictedIawpAt)
  if (baselineMs == null) return provisional ?? baseline
  if (provisional && provisionalMs != null && provisionalMs < baselineMs) {
    const gainSeconds = Math.round((baselineMs - provisionalMs) / 1000)
    return {
      ...provisional,
      reason: `${provisional.reason} · CLIMB PROTECTION accepted LIVE ${gainSeconds}s earlier than takeoff baseline`,
    }
  }
  if (provisionalMs != null) {
    const lateSeconds = Math.max(0, Math.round((provisionalMs - baselineMs) / 1000))
    return {
      ...baseline,
      reason: `${baseline.reason} · CLIMB PROTECTION held takeoff baseline; provisional LIVE was ${lateSeconds}s later`,
    }
  }
  return {
    ...baseline,
    reason: `${baseline.reason} · CLIMB PROTECTION held takeoff baseline; provisional LIVE unavailable`,
  }
}

/**
 * Progressive ETA source priority for the Approach AMAN:
 * takeoff + EET - STAR establishes the initial ETA-FF baseline. During climb below the
 * position-model trigger (normally about FL300), route/GS may move ETA earlier but a low
 * climb GS cannot make the displayed ETA later than that takeoff baseline. At the trigger
 * or once descent is detected, LIVE_ROUTE becomes unrestricted in both directions.
 */
export function estimateIawpArrival(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  nominalStarSeconds: number,
  fetchedAt: string,
  performance: AircraftPerformanceProfile | null = null,
): ArrivalEtaEstimate {
  const trend = recordTrackTrend(flight, fetchedAt)
  const resolvedPerformance = performance ?? cachedPerformance(flight)
  const referenceIso = flight.connectedAt || fetchedAt
  const takeoffBaseline = takeoffBaselineEstimate(flight, nominalStarSeconds, referenceIso)

  if (geometry && climbProtectionActive(flight, trend) && takeoffBaseline) {
    const provisional = provisionalClimbLiveEstimate(flight, geometry, refFix, fetchedAt, trend)
    return protectedClimbEstimate(takeoffBaseline, provisional)
  }

  if (geometry) {
    const live = liveRouteEstimate(flight, geometry, refFix, fetchedAt, resolvedPerformance, trend)
    if (live) return live
  }

  if (takeoffBaseline) return takeoffBaseline

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
    groundSpeedKt: observedGroundSpeedKt(flight, trend),
    pastCrossing: false,
    reason: `ETA DBG UNAVAILABLE · SAMPLES ${trend.sampleCount}/${trend.windowSeconds}s · No usable live route or flight-plan timing source`,
    modelPhase: 'FALLBACK',
    trackSampleCount: trend.sampleCount,
    verticalTrendFpm: resolvedVerticalTrendFpm(flight, trend),
  }
}
