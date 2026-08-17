import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findAipIawp } from './aipArrivalIawp'
import './ivaoTraffic.css'

type TrafficFlight = {
  sessionId: string
  vid: string | null
  callsign: string
  aircraft: string | null
  departure: string | null
  arrival: string
  route: string | null
  state: string | null
  altitude: number | null
  groundSpeed: number | null
  latitude: number | null
  longitude: number | null
  heading: number | null
  connectedAt: string | null
  airlineIcao: string | null
  departureCountryId: string | null
  arrivalCountryId: string | null
  isDomesticThailand: boolean
  filedEetSeconds: number | null
  trackedTakeoffAt: string | null
  filedDestinationEtaAt: string | null
  domesticTriggerStatus: 'READY' | 'WAITING_TAKEOFF' | 'EET_UNAVAILABLE' | 'TAKEOFF_UNAVAILABLE' | 'NOT_DOMESTIC' | 'UNKNOWN'
}

type TrafficAddItem = {
  flight: TrafficFlight
  refFix: string
  eto: string
}

type StarProcedure = { designator: string; entryFix: string }

type Props = {
  airport: string
  fixes: string[]
  starProcedures: StarProcedure[]
  existingCallsigns: string[]
  disabled?: boolean
  onAdd: (flight: TrafficFlight, refFix: string, eto: string) => Promise<void>
  onAddAll: (items: TrafficAddItem[]) => Promise<void>
}

type TrafficPayload = {
  airport?: string
  fetchedAt?: string
  flights?: TrafficFlight[]
  error?: string
}

type Coordinates = { lat: number; lon: number }
type RoutePoint = { identifier: string; type: string | null; coordinates: Coordinates }
type RouteSegment = {
  from: RoutePoint
  to: RoutePoint
  distance: number
  bearing: number | null
  cumulativeDistance: number
}
type RouteGeometry = {
  origin: string
  destination: string
  totalDistance: number | null
  segments: RouteSegment[]
  errors: Array<{ type: string; message: string }>
}
type RouteGeometryPayload = RouteGeometry & { error?: string }

type Draft = {
  refFix: string
  eto: string
  refFixManual: boolean
  etoManual: boolean
}

type AutoEstimate = {
  status: 'ready' | 'waiting' | 'unavailable' | 'calculating'
  refFix: string | null
  eto: string
  remainingNm: number | null
  minutes: number | null
  groundSpeed: number | null
  offRouteNm: number | null
  reason: string | null
  pastCrossing?: boolean
  crossingAgeMin?: number | null
  assumedDirect?: boolean
  autoAssignedFix?: boolean
  filedStarDesignator?: string | null
  aipMappedFrom?: string | null
  triggerSource?: 'live-route' | 'domestic-eet'
  triggerEta?: string | null
}

type RouteProgress = { progressNm: number; offRouteNm: number }

const AUTO_REFRESH_MS = 30_000
const IDLE_TIMEOUT_MS = 10 * 60_000
const IDLE_CHECK_MS = 15_000
const DEFAULT_AUTO_ETO_LOOKAHEAD_MIN = 60
const AUTO_ETO_LOOKAHEAD_OPTIONS = [30, 45, 60, 90, 120, 180, 240]
const AUTO_ETO_LOOKAHEAD_STORAGE_KEY = 'ivao-auto-eto-lookahead-min'
const MIN_AUTO_GS_KT = 80
const MAX_ROUTE_DEVIATION_NM = 100

const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
const routeKey = (flight: TrafficFlight, airport: string) => `${flight.departure || ''}|${airport}|${flight.route || ''}`

function formatUtcHhmm(timestampMs: number) {
  const date = new Date(timestampMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function filedStarEntryFix(route: string | null, starProcedures: StarProcedure[], fixes: string[]) {
  if (!route || !starProcedures.length) return null
  const tokens = route.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const allowedFixes = new Set(fixes.map((fix) => fix.toUpperCase()))
  let best: { designator: string; entryFix: string; index: number } | null = null
  for (const star of starProcedures) {
    const designator = star.designator.trim().toUpperCase()
    const entryFix = star.entryFix.trim().toUpperCase()
    if (!designator || !entryFix || !allowedFixes.has(entryFix)) continue
    const index = tokens.lastIndexOf(designator)
    if (index < 0) continue
    if (!best || index > best.index) best = { designator, entryFix, index }
  }
  return best
}

function suggestedFix(route: string | null, fixes: string[]) {
  if (!fixes.length || !route) return ''
  const normalized = ` ${route.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `
  let best = ''
  let bestIndex = -1
  for (const fix of fixes) {
    const index = normalized.lastIndexOf(` ${fix.toUpperCase()} `)
    if (index > bestIndex) {
      bestIndex = index
      best = fix
    }
  }
  return best
}

function formatTrack(flight: TrafficFlight) {
  const parts: string[] = []
  if (flight.altitude != null) parts.push(`ALT ${Math.round(flight.altitude)} ft`)
  if (flight.groundSpeed != null) parts.push(`${Math.round(flight.groundSpeed)} kt`)
  if (flight.state) parts.push(flight.state)
  return parts.join(' · ') || 'Online'
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

function findRouteProgress(flight: TrafficFlight, geometry: RouteGeometry): RouteProgress | null {
  if (flight.latitude == null || flight.longitude == null) return null
  const current = { lat: flight.latitude, lon: flight.longitude }
  let best: RouteProgress | null = null

  for (const segment of geometry.segments) {
    if (!Number.isFinite(segment.distance) || !Number.isFinite(segment.cumulativeDistance)) continue
    const projected = segmentProjection(current, segment)
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    const progressNm = startDistance + projected.t * segment.distance
    if (!best || projected.distanceNm < best.offRouteNm) {
      best = { progressNm, offRouteNm: projected.distanceNm }
    }
  }
  return best
}

function fixDistancesAlongRoute(geometry: RouteGeometry, fix: string) {
  const target = fix.trim().toUpperCase()
  const candidates: number[] = []
  for (const segment of geometry.segments) {
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    if (segment.from.identifier.toUpperCase() === target) candidates.push(startDistance)
    if (segment.to.identifier.toUpperCase() === target) candidates.push(segment.cumulativeDistance)
  }
  return candidates.sort((a, b) => a - b)
}

function fixDistanceAlongRoute(geometry: RouteGeometry, fix: string, currentProgressNm: number) {
  return fixDistancesAlongRoute(geometry, fix).find((distance) => distance >= currentProgressNm - 1) ?? null
}

function passedFixDistanceAlongRoute(geometry: RouteGeometry, fix: string, currentProgressNm: number) {
  const candidates = fixDistancesAlongRoute(geometry, fix).filter((distance) => distance < currentProgressNm - 1)
  return candidates.length ? candidates[candidates.length - 1] : null
}

function upcomingConfiguredFix(flight: TrafficFlight, geometry: RouteGeometry, fixes: string[]) {
  const progress = findRouteProgress(flight, geometry)
  if (!progress) return suggestedFix(flight.route, fixes)

  const ahead = fixes
    .map((fix) => ({ fix, distance: fixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => a.distance - b.distance)
  if (ahead[0]) return ahead[0].fix

  const passed = fixes
    .map((fix) => ({ fix, distance: passedFixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => b.distance - a.distance)
  return passed[0]?.fix || suggestedFix(flight.route, fixes)
}

function remainingDistanceToFix(flight: TrafficFlight, geometry: RouteGeometry, fix: string) {
  const progress = findRouteProgress(flight, geometry)
  if (progress) {
    const target = fixDistanceAlongRoute(geometry, fix, progress.progressNm)
    if (target != null) return Math.max(0, target - progress.progressNm) + progress.offRouteNm
  }
  const distances = fixDistancesAlongRoute(geometry, fix)
  return distances.length ? distances[distances.length - 1] : null
}

function autoEstimate(
  flight: TrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  groundSpeed: number | null,
  baseTimeIso: string,
  lookaheadMin: number,
): AutoEstimate {
  const baseTime = new Date(baseTimeIso).getTime()
  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now()

  if (!refFix) return { status: 'unavailable', refFix: null, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'No REF FIX' }
  if (!flight.route || !flight.departure) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Filed route unavailable' }

  if (flight.isDomesticThailand && flight.domesticTriggerStatus === 'WAITING_TAKEOFF') {
    return {
      status: 'waiting', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null,
      reason: 'Domestic flight waiting for tracked takeoff', triggerSource: 'domestic-eet', triggerEta: null,
    }
  }

  if (flight.latitude == null || flight.longitude == null) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Live position unavailable' }
  if (!geometry) return { status: 'calculating', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Resolving filed route' }
  if (groundSpeed == null || groundSpeed < MIN_AUTO_GS_KT) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Ground speed too low' }

  const progress = findRouteProgress(flight, geometry)
  if (!progress) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Unable to locate aircraft on route' }
  if (progress.offRouteNm > MAX_ROUTE_DEVIATION_NM) {
    return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: progress.offRouteNm, reason: 'Aircraft too far from filed route' }
  }

  const finalSegment = geometry.segments[geometry.segments.length - 1]
  const routeEndDistance = geometry.totalDistance ?? finalSegment?.cumulativeDistance ?? progress.progressNm
  const remainingToDestinationNm = Math.max(0, routeEndDistance - progress.progressNm) + progress.offRouteNm
  const liveMinutesToDestination = remainingToDestinationNm / groundSpeed * 60

  let triggerMinutesToDestination = liveMinutesToDestination
  let triggerSource: 'live-route' | 'domestic-eet' = 'live-route'
  let triggerEta: string | null = null

  if (flight.isDomesticThailand && flight.domesticTriggerStatus === 'READY' && flight.filedDestinationEtaAt) {
    const domesticEtaMs = new Date(flight.filedDestinationEtaAt).getTime()
    if (Number.isFinite(domesticEtaMs)) {
      triggerMinutesToDestination = (domesticEtaMs - safeBaseTime) / 60_000
      triggerSource = 'domestic-eet'
      triggerEta = flight.filedDestinationEtaAt
    }
  }

  const targetDistance = fixDistanceAlongRoute(geometry, refFix, progress.progressNm)
  if (targetDistance != null) {
    const remainingNm = Math.max(0, targetDistance - progress.progressNm) + progress.offRouteNm
    const minutesToFix = remainingNm / groundSpeed * 60
    const eto = formatUtcHhmm(safeBaseTime + minutesToFix * 60_000)

    if (triggerMinutesToDestination > lookaheadMin) {
      return {
        status: 'waiting', refFix, eto, remainingNm, minutes: triggerMinutesToDestination,
        groundSpeed, offRouteNm: progress.offRouteNm,
        reason: triggerSource === 'domestic-eet' ? 'Domestic tracked-takeoff + filed-EET ETA outside window' : 'Outside ' + lookaheadMin + ' min ETA window',
        triggerSource, triggerEta,
      }
    }
    return {
      status: 'ready', refFix, eto, remainingNm, minutes: triggerMinutesToDestination,
      groundSpeed, offRouteNm: progress.offRouteNm, reason: null, triggerSource, triggerEta,
    }
  }

  const routeFixDistances = fixDistancesAlongRoute(geometry, refFix)
  if (!routeFixDistances.length) {
    return {
      status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: triggerMinutesToDestination,
      groundSpeed, offRouteNm: progress.offRouteNm, reason: 'REF FIX not in filed route', triggerSource, triggerEta,
    }
  }

  const passedDistance = passedFixDistanceAlongRoute(geometry, refFix, progress.progressNm)
  if (passedDistance == null) {
    return {
      status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: triggerMinutesToDestination,
      groundSpeed, offRouteNm: progress.offRouteNm, reason: 'REF FIX not ahead in resolved route', triggerSource, triggerEta,
    }
  }

  const distanceSinceFix = Math.max(0, progress.progressNm - passedDistance) + progress.offRouteNm
  const crossingAgeMin = distanceSinceFix / groundSpeed * 60
  const eto = formatUtcHhmm(safeBaseTime - crossingAgeMin * 60_000)

  if (triggerMinutesToDestination > lookaheadMin) {
    return {
      status: 'waiting', refFix, eto, remainingNm: distanceSinceFix, minutes: triggerMinutesToDestination,
      groundSpeed, offRouteNm: progress.offRouteNm,
      reason: triggerSource === 'domestic-eet' ? 'REF FIX already passed; domestic filed-EET ETA outside window' : 'REF FIX already passed; outside ' + lookaheadMin + ' min ETA window',
      pastCrossing: true, crossingAgeMin, triggerSource, triggerEta,
    }
  }

  return {
    status: 'ready', refFix, eto, remainingNm: distanceSinceFix, minutes: triggerMinutesToDestination,
    groundSpeed, offRouteNm: progress.offRouteNm, reason: 'Estimated past REF FIX crossing',
    pastCrossing: true, crossingAgeMin, triggerSource, triggerEta,
  }
}

function estimateText(estimate: AutoEstimate | undefined, manual: boolean, lookaheadMin: number) {
  if (!estimate) return 'AUTO ETO · waiting for route data'
  const domesticEta = estimate.triggerSource === 'domestic-eet' && estimate.triggerEta
    ? ' · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z'
    : ''
  const filedStar = estimate.filedStarDesignator ? ' · FILED STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix : ''
  const aipIawp = estimate.aipMappedFrom ? ' · AIP IAWP ' + estimate.refFix + ' · FROM ' + estimate.aipMappedFrom : ''

  if (manual) {
    if (estimate.status === 'ready') {
      if (estimate.assumedDirect && estimate.filedStarDesignator) return 'MANUAL ETO · filed STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix + ' · ' + estimate.eto + 'Z available' + domesticEta
      if (estimate.assumedDirect && estimate.aipMappedFrom) return 'MANUAL ETO · AIP IAWP ' + estimate.refFix + ' from ' + estimate.aipMappedFrom + ' · ' + estimate.eto + 'Z available' + domesticEta
      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta
      if (estimate.pastCrossing) return 'MANUAL ETO · estimated past crossing ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + domesticEta
      return 'MANUAL ETO · auto estimate ' + estimate.eto + 'Z available' + domesticEta
    }
    return 'MANUAL ETO · automatic estimate not applied'
  }
  if (estimate.status === 'ready') {
    if (estimate.assumedDirect) {
      const past = estimate.pastCrossing ? ' · EST PAST XING' : ''
      const routeLabel = estimate.filedStarDesignator
        ? filedStar + ' · ROUTE→STAR ENTRY'
        : estimate.aipMappedFrom
          ? aipIawp + ' · ROUTE→IAWP'
          : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT'
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z' + routeLabel + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
    }
    if (estimate.pastCrossing) {
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · EST PAST XING · ~' + Math.round(estimate.remainingNm || 0) + ' NM / ' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
    }
    return 'AUTO ETO · ' + estimate.refFix + ' ' + estimate.eto + 'Z' + aipIawp + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
  }
  if (estimate.status === 'waiting') {
    if (estimate.reason === 'Domestic flight waiting for tracked takeoff') {
      return 'AUTO ETO waiting · TH DOMESTIC · waiting for tracked wheels-off + filed EET'
    }
    if (estimate.triggerSource === 'domestic-eet' && estimate.triggerEta) {
      const minutes = Math.max(0, Math.ceil(estimate.minutes || 0))
      const assumed = estimate.assumedDirect
        ? (estimate.filedStarDesignator
          ? filedStar + ' · ROUTE→STAR ENTRY'
          : estimate.aipMappedFrom
            ? aipIawp + ' · ROUTE→IAWP'
            : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT')
        : aipIawp
      return 'AUTO ETO waiting · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z · ~' + minutes + ' min' + assumed + ' · auto-fill starts ETA ≤' + lookaheadMin + ' min'
    }
    if (estimate.assumedDirect && estimate.filedStarDesignator) return 'AUTO ETO waiting' + filedStar + ' · ROUTE→STAR ENTRY · ETA >' + lookaheadMin + ' min'
    if (estimate.assumedDirect && estimate.aipMappedFrom) return 'AUTO ETO waiting' + aipIawp + ' · ROUTE→IAWP · ETA >' + lookaheadMin + ' min'
    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'
    if (estimate.pastCrossing) return 'AUTO ETO waiting · ' + estimate.refFix + ' already passed ~' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · ETA >' + lookaheadMin + ' min'
    return 'AUTO ETO waiting · ~' + Math.ceil(estimate.minutes || 0) + ' min to destination · auto-fill starts ETA ≤' + lookaheadMin + ' min'
  }
  if (estimate.status === 'calculating') return 'AUTO ETO · ' + (estimate.reason || 'calculating')
  return 'AUTO ETO unavailable · ' + (estimate.reason || 'insufficient data')
}

export default function IvaoTrafficPanel({ airport, fixes, starProcedures, existingCallsigns, disabled, onAdd, onAddAll }: Props) {
  const [flights, setFlights] = useState<TrafficFlight[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [autoEstimates, setAutoEstimates] = useState<Record<string, AutoEstimate>>({})
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)
  const [locallyAddedCallsigns, setLocallyAddedCallsigns] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [lookaheadMin, setLookaheadMin] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(AUTO_ETO_LOOKAHEAD_STORAGE_KEY))
      return AUTO_ETO_LOOKAHEAD_OPTIONS.includes(stored) ? stored : DEFAULT_AUTO_ETO_LOOKAHEAD_MIN
    } catch {
      return DEFAULT_AUTO_ETO_LOOKAHEAD_MIN
    }
  })
  const lastActivityRef = useRef(Date.now())
  const idleRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const draftsRef = useRef<Record<string, Draft>>({})
  const geometryCacheRef = useRef(new Map<string, RouteGeometry | null>())
  const geometryPendingRef = useRef(new Map<string, Promise<RouteGeometry | null>>())
  const gsHistoryRef = useRef(new Map<string, number[]>())

  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])

  useEffect(() => {
    setLocallyAddedCallsigns((current) => {
      let changed = false
      const next = new Set(current)
      for (const callsign of current) {
        if (!existing.has(callsign)) continue
        next.delete(callsign)
        changed = true
      }
      return changed ? next : current
    })
  }, [existing])

  useEffect(() => {
    try { window.localStorage.setItem(AUTO_ETO_LOOKAHEAD_STORAGE_KEY, String(lookaheadMin)) } catch { /* ignore storage failures */ }
  }, [lookaheadMin])

  const setDraftState = useCallback((next: Record<string, Draft>) => {
    draftsRef.current = next
    setDrafts(next)
  }, [])

  const smoothedGroundSpeed = useCallback((flight: TrafficFlight) => {
    const current = flight.groundSpeed
    if (current != null && current >= MIN_AUTO_GS_KT && current <= 750) {
      const samples = [...(gsHistoryRef.current.get(flight.sessionId) || []), current].slice(-4)
      gsHistoryRef.current.set(flight.sessionId, samples)
    }
    const samples = gsHistoryRef.current.get(flight.sessionId) || []
    if (!samples.length) return current
    return samples.reduce((sum, value) => sum + value, 0) / samples.length
  }, [])

  const getRouteGeometry = useCallback(async (flight: TrafficFlight) => {
    if (!flight.departure || !flight.route) return null
    const key = routeKey(flight, airport)
    if (geometryCacheRef.current.has(key)) return geometryCacheRef.current.get(key) ?? null
    const pending = geometryPendingRef.current.get(key)
    if (pending) return pending

    const request = (async () => {
      try {
        const response = await fetch('/api/sequence/route-geometry', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: flight.departure, destination: airport, route: flight.route }),
        })
        const payload = await response.json() as RouteGeometryPayload
        if (!response.ok) throw new Error(payload.error || `Route geometry returned ${response.status}`)
        geometryCacheRef.current.set(key, payload)
        return payload
      } catch {
        return null
      } finally {
        geometryPendingRef.current.delete(key)
      }
    })()

    geometryPendingRef.current.set(key, request)
    return request
  }, [airport])

  const getAssumedRouteGeometry = useCallback(async (flight: TrafficFlight, refFix: string) => {
    if (!flight.departure || !flight.route || !refFix) return null
    const assumedRoute = `${flight.route} DCT ${refFix}`.trim().replace(/\s+/g, ' ')
    const key = `${flight.departure}|${airport}|ASSUMED-DCT|${assumedRoute}`
    if (geometryCacheRef.current.has(key)) return geometryCacheRef.current.get(key) ?? null
    const pending = geometryPendingRef.current.get(key)
    if (pending) return pending

    const request = (async () => {
      try {
        const response = await fetch('/api/sequence/route-geometry', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: flight.departure, destination: airport, route: assumedRoute }),
        })
        const payload = await response.json() as RouteGeometryPayload
        if (!response.ok) throw new Error(payload.error || `Route geometry returned ${response.status}`)
        geometryCacheRef.current.set(key, payload)
        return payload
      } catch {
        return null
      } finally {
        geometryPendingRef.current.delete(key)
      }
    })()

    geometryPendingRef.current.set(key, request)
    return request
  }, [airport])

  const estimateForRefFix = useCallback(async (
    flight: TrafficFlight,
    geometry: RouteGeometry | null,
    refFix: string,
    groundSpeed: number | null,
    baseTimeIso: string,
    autoAssignedFix = false,
    filedStarDesignator: string | null = null,
    aipMappedFrom: string | null = null,
  ) => {
    let estimate: AutoEstimate = { ...autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin), filedStarDesignator, aipMappedFrom }
    if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route' && refFix) {
      const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
      if (assumedGeometry) {
        const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, groundSpeed, baseTimeIso, lookaheadMin)
        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix, filedStarDesignator, aipMappedFrom }
      }
    }
    return estimate
  }, [getAssumedRouteGeometry, lookaheadMin])

  const autoAssignUnfiledFix = useCallback(async (
    flight: TrafficFlight,
    geometry: RouteGeometry | null,
    groundSpeed: number | null,
    baseTimeIso: string,
  ) => {
    if (!geometry || !fixes.length) return null
    if (fixes.some((fix) => fixDistancesAlongRoute(geometry, fix).length > 0)) return null

    const candidates = await Promise.all(fixes.map(async (fix) => {
      const assumedGeometry = await getAssumedRouteGeometry(flight, fix)
      if (!assumedGeometry) return null
      const score = remainingDistanceToFix(flight, assumedGeometry, fix)
      if (score == null || !Number.isFinite(score)) return null
      const estimate = autoEstimate(flight, assumedGeometry, fix, groundSpeed, baseTimeIso, lookaheadMin)
      return {
        refFix: fix,
        score,
        estimate: { ...estimate, assumedDirect: true, autoAssignedFix: true } as AutoEstimate,
      }
    }))

    return candidates
      .filter((candidate): candidate is { refFix: string; score: number; estimate: AutoEstimate } => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null
  }, [fixes, getAssumedRouteGeometry, lookaheadMin])

  const refresh = useCallback(async () => {
    if (!airport || refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/sequence/ivao-traffic?airport=${encodeURIComponent(airport)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const payload = await response.json() as TrafficPayload
      if (!response.ok) throw new Error(payload.error || `IVAO traffic returned ${response.status}`)
      const nextFlights = payload.flights || []
      const nextFetchedAt = payload.fetchedAt || new Date().toISOString()
      setFlights(nextFlights)
      setFetchedAt(nextFetchedAt)

      const geometries = new Map<string, RouteGeometry | null>()
      await Promise.all(nextFlights.map(async (flight) => {
        geometries.set(flight.sessionId, await getRouteGeometry(flight))
      }))

      const currentDrafts = draftsRef.current
      const nextDrafts: Record<string, Draft> = {}
      const nextAuto: Record<string, AutoEstimate> = {}
      for (const flight of nextFlights) {
        const geometry = geometries.get(flight.sessionId) ?? null
        const previous = currentDrafts[flight.sessionId]
        const gs = smoothedGroundSpeed(flight)
        const filedStar = filedStarEntryFix(flight.route, starProcedures, fixes)
        const starEntryFixes = [...new Set(starProcedures.map((star) => star.entryFix.toUpperCase()))]
        const aipMapped = filedStar ? null : findAipIawp(airport, flight.route, starEntryFixes)
        const filedSuggested = filedStar?.entryFix || aipMapped?.entryFix || (geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes))
        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested
        let estimate: AutoEstimate | null = null

        if (previous?.refFixManual) {
          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, false)
        } else if (filedStar) {
          estimate = await estimateForRefFix(flight, geometry, filedStar.entryFix, gs, nextFetchedAt, false, filedStar.designator)
        } else if (aipMapped) {
          estimate = await estimateForRefFix(flight, geometry, aipMapped.entryFix, gs, nextFetchedAt, false, null, aipMapped.via)
        } else if (filedSuggested) {
          estimate = autoEstimate(flight, geometry, filedSuggested, gs, nextFetchedAt, lookaheadMin)
        } else if (previous?.refFix && fixes.includes(previous.refFix)) {
          refFix = previous.refFix
          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, true)
        } else {
          const assigned = await autoAssignUnfiledFix(flight, geometry, gs, nextFetchedAt)
          if (assigned) {
            refFix = assigned.refFix
            estimate = assigned.estimate
          }
        }

        if (!refFix) refFix = fixes[0] || ''
        if (!estimate) estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, !filedSuggested)

        const etoManual = previous?.etoManual ?? false
        const eto = etoManual ? (previous?.eto || '') : (estimate.status === 'ready' ? estimate.eto : '')
        nextDrafts[flight.sessionId] = {
          refFix,
          eto,
          refFixManual: previous?.refFixManual ?? false,
          etoManual,
        }
        nextAuto[flight.sessionId] = estimate
      }
      setDraftState(nextDrafts)
      setAutoEstimates(nextAuto)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      refreshInFlightRef.current = false
      setLoading(false)
    }
  }, [airport, autoAssignUnfiledFix, estimateForRefFix, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed, starProcedures])

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (!idleRef.current) return
    idleRef.current = false
    setIdle(false)
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel']
    for (const eventName of activityEvents) window.addEventListener(eventName, markActivity, { passive: true })
    return () => {
      for (const eventName of activityEvents) window.removeEventListener(eventName, markActivity)
    }
  }, [markActivity])

  useEffect(() => {
    if (!open) return

    const autoRefreshTimer = window.setInterval(() => {
      if (idleRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        idleRef.current = true
        setIdle(true)
        return
      }
      void refresh()
    }, AUTO_REFRESH_MS)

    const idleCheckTimer = window.setInterval(() => {
      if (idleRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        idleRef.current = true
        setIdle(true)
      }
    }, IDLE_CHECK_MS)

    return () => {
      window.clearInterval(autoRefreshTimer)
      window.clearInterval(idleCheckTimer)
    }
  }, [open, refresh])

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open
    setOpen(nextOpen)
    if (!nextOpen) return
    lastActivityRef.current = Date.now()
    idleRef.current = false
    setIdle(false)
    void refresh()
  }

  const manualRefresh = () => {
    lastActivityRef.current = Date.now()
    idleRef.current = false
    setIdle(false)
    void refresh()
  }

  const changeLookahead = (minutes: number) => {
    if (!AUTO_ETO_LOOKAHEAD_OPTIONS.includes(minutes)) return
    setLookaheadMin(minutes)
  }

  useEffect(() => {
    if (open) void refresh()
  }, [lookaheadMin])

  const changeRefFix = async (flight: TrafficFlight, refFix: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix, eto: '', refFixManual: false, etoManual: false }
    const geometry = geometryCacheRef.current.get(routeKey(flight, airport)) ?? null
    const gsSamples = gsHistoryRef.current.get(flight.sessionId) || []
    const gs = gsSamples.length ? gsSamples.reduce((sum, value) => sum + value, 0) / gsSamples.length : flight.groundSpeed
    const baseTime = fetchedAt || new Date().toISOString()
    const estimate = await estimateForRefFix(flight, geometry, refFix, gs, baseTime, false)
    const nextDraft = {
      ...current,
      refFix,
      refFixManual: true,
      eto: current.etoManual ? current.eto : (estimate.status === 'ready' ? estimate.eto : ''),
    }
    const next = { ...draftsRef.current, [flight.sessionId]: nextDraft }
    setDraftState(next)
    setAutoEstimates((all) => ({ ...all, [flight.sessionId]: estimate }))
  }

  const changeEto = (flight: TrafficFlight, eto: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix: fixes[0] || '', eto: '', refFixManual: false, etoManual: false }
    const next = {
      ...draftsRef.current,
      [flight.sessionId]: { ...current, eto: eto.replace(/[^0-9:]/g, '').slice(0, 5), etoManual: true },
    }
    setDraftState(next)
  }

  const useAutoEto = (flight: TrafficFlight) => {
    const estimate = autoEstimates[flight.sessionId]
    if (!estimate || estimate.status !== 'ready') return
    const current = draftsRef.current[flight.sessionId]
    if (!current) return
    setDraftState({
      ...draftsRef.current,
      [flight.sessionId]: { ...current, eto: estimate.eto, etoManual: false },
    })
  }

  const bulkItems = useMemo<TrafficAddItem[]>(() => {
    if (disabled) return []
    return flights.flatMap((flight) => {
      const callsign = flight.callsign.toUpperCase()
      if (existing.has(callsign) || locallyAddedCallsigns.has(callsign)) return []
      const draft = drafts[flight.sessionId]
      if (!draft?.refFix || !validTime(draft.eto)) return []
      return [{ flight, refFix: draft.refFix, eto: draft.eto }]
    })
  }, [disabled, drafts, existing, flights, locallyAddedCallsigns])

  const add = async (flight: TrafficFlight) => {
    const draft = drafts[flight.sessionId]
    if (!draft || !draft.refFix || !validTime(draft.eto)) return
    setAdding(flight.sessionId)
    setError(null)
    setBulkNotice(null)
    try {
      await onAdd(flight, draft.refFix, draft.eto)
      setLocallyAddedCallsigns((current) => new Set(current).add(flight.callsign.toUpperCase()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(null)
    }
  }

  const addAll = async () => {
    if (!bulkItems.length || bulkAdding) return
    const eligibleFlights = flights.filter((flight) => {
      const callsign = flight.callsign.toUpperCase()
      return !existing.has(callsign) && !locallyAddedCallsigns.has(callsign)
    }).length
    setBulkAdding(true)
    setBulkNotice(null)
    setError(null)
    try {
      await onAddAll(bulkItems)
      setLocallyAddedCallsigns((current) => {
        const next = new Set(current)
        for (const item of bulkItems) next.add(item.flight.callsign.toUpperCase())
        return next
      })
      const skipped = Math.max(0, eligibleFlights - bulkItems.length)
      setBulkNotice(`Added ${bulkItems.length} flight${bulkItems.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} waiting/unavailable` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkAdding(false)
    }
  }

  return (
    <details className="ivao-traffic-menu" onToggle={handleToggle}>
      <summary className="ivao-traffic-trigger" title={`IVAO inbound traffic for ${airport}`}>
        IVAO Traffic <b>{flights.length}</b>
      </summary>
      <div className="ivao-traffic-popover">
        <div className="ivao-traffic-heading">
          <div>
            <strong>IVAO inbound · {airport}</strong>
            <span>AUTO ETO uses filed-route distance + live GS. Thailand domestic flights use tracked wheels-off + filed EET for the look-ahead trigger. Filed STAR/REF FIX is preferred; when none is filed, the system auto-assigns the shortest usable configured REF FIX using an assumed-DCT continuation.</span>
          </div>
          <div className="ivao-traffic-heading-actions">
            <label className="ivao-lookahead-control"><span>START AUTO ETO</span><select value={lookaheadMin} onChange={(event) => changeLookahead(Number(event.target.value))}>{AUTO_ETO_LOOKAHEAD_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>ETA ≤ {minutes} min</option>)}</select></label>
            <button type="button" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button type="button" className="ivao-add-all" onClick={() => void addAll()} disabled={disabled || bulkAdding || bulkItems.length === 0} title="Add every IVAO arrival with a valid ETO; waiting or unavailable flights are skipped">{bulkAdding ? 'Adding…' : `Add All${bulkItems.length ? ` (${bulkItems.length})` : ''}`}</button>
          </div>
        </div>

        {bulkNotice && <div className="ivao-bulk-notice">{bulkNotice}</div>}
        {error && <div className="ivao-traffic-error">{error}</div>}
        {!error && flights.length === 0 && <div className="ivao-traffic-empty">No connected IVAO arrivals to {airport}.</div>}

        <div className="ivao-traffic-list">
          {flights.map((flight) => {
            const draft = drafts[flight.sessionId] || { refFix: fixes[0] || '', eto: '', refFixManual: false, etoManual: false }
            const estimate = autoEstimates[flight.sessionId]
            const callsign = flight.callsign.toUpperCase()
            const alreadyAdded = existing.has(callsign) || locallyAddedCallsigns.has(callsign)
            const canAdd = !disabled && !bulkAdding && !alreadyAdded && Boolean(draft.refFix) && validTime(draft.eto)
            return <article className="ivao-traffic-flight" key={flight.sessionId}>
              <div className="ivao-traffic-logo">
                {flight.airlineIcao
                  ? <img src={`/api/sequence/airline-logo?icao=${encodeURIComponent(flight.airlineIcao)}`} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                  : <span>{flight.callsign.slice(0, 2)}</span>}
              </div>
              <div className="ivao-traffic-main">
                <div className="ivao-traffic-call"><strong>{flight.callsign}</strong><span>{flight.aircraft || '—'}</span></div>
                <div className="ivao-traffic-route"><strong>{flight.departure || '----'}</strong><span>→</span><strong>{airport}</strong>{flight.vid && <small>VID {flight.vid}</small>}</div>
                <small className="ivao-traffic-track">{formatTrack(flight)}</small>
                <small className={`ivao-auto-eto ${draft.etoManual ? 'is-manual' : estimate?.assumedDirect && estimate?.status === 'ready' ? 'is-assumed' : estimate?.pastCrossing && estimate?.status === 'ready' ? 'is-past' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}`}>
                  {estimateText(estimate, draft.etoManual, lookaheadMin)}
                </small>
                {flight.route && <small className="ivao-traffic-fpl" title={flight.route}>{flight.route}</small>}
              </div>
              <div className="ivao-traffic-plan">
                <label><span>REF FIX{!draft.refFixManual && <em>AUTO</em>}</span><select value={draft.refFix} disabled={alreadyAdded || disabled} onChange={(event) => void changeRefFix(flight, event.target.value)}>{fixes.map((fix) => <option key={fix} value={fix}>{fix}</option>)}</select></label>
                <label className="ivao-eto-label"><span>ETO UTC{!draft.etoManual && estimate?.status === 'ready' && <em>AUTO</em>}</span><input className={!draft.etoManual && estimate?.status === 'ready' ? 'is-auto' : ''} value={draft.eto} placeholder="HH:MM" inputMode="numeric" maxLength={5} disabled={alreadyAdded || disabled} onChange={(event) => changeEto(flight, event.target.value)} />{draft.etoManual && estimate?.status === 'ready' && <button type="button" className="ivao-use-auto" onClick={() => useAutoEto(flight)}>Use auto</button>}</label>
                <button type="button" className="ivao-traffic-add" disabled={!canAdd || adding === flight.sessionId} onClick={() => void add(flight)}>{alreadyAdded ? 'In sequence' : adding === flight.sessionId ? 'Adding…' : 'Add'}</button>
              </div>
            </article>
          })}
        </div>

        <div className="ivao-traffic-footer">
          <span>{fetchedAt ? `Updated ${new Date(fetchedAt).toISOString().slice(11, 19)}Z` : 'Waiting for IVAO data'} · AUTO ETO window {lookaheadMin} min · planning estimate</span>
          <span>{idle ? 'Auto-refresh paused · idle 10 min' : 'Auto-refresh 30s · panel open only'}</span>
        </div>
      </div>
    </details>
  )
}

export type { TrafficAddItem, TrafficFlight }
