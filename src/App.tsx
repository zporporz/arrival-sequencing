import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import ivaoThailandLogo from './assets/ivao-thailand-logo.png'
import { useAuthUser } from './AuthGate'
import { findAipIawp } from './aipArrivalIawp'
import {
  AMAN_DEFAULT_RUNWAY_SPACING_NM,
  AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES,
  AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES,
  AMAN_SPECIAL_SEPARATION_MINUTES,
  BANGKOK_TMA_WORKING_RADIUS_NM,
  BKK_VOR_COORDINATES,
  VTBD_IAWP_COMPACT_CODES,
  VTBD_IAWP_COMPACT_CODE_STYLE,
  VTBD_IAWP_NOMINAL_MINUTES,
  VTBS_STAR19_NOMINAL_MINUTES,
  nmToMinutesAtReferenceSpeed,
} from './core/amanConstants'
import { readIvaoTraffic, readRouteGeometry, type IvaoArrivalTrafficFlight } from './core/api'
import { estimateIawpArrival, type RouteGeometry } from './core/arrivalEta'
import {
  autoSequenceUnstableArrivals,
  averageDelayMinutes,
  calculateArrivalMetrics,
  type AmanArrivalPrediction,
  type AmanSequenceRow,
} from './core/arrivalSequencing'

type AirportCode = 'VTBD' | 'VTBS'
type AirportScope = AirportCode | 'BOTH'
type RunwayMode = 'ARR' | 'DEP' | 'MIX' | 'CLOSED'
type PlanningState = 'SEQUENCED' | 'MONITORED' | 'LATE'

type InboundPreview = {
  airport: AirportCode
  id: string
  flight: IvaoArrivalTrafficFlight
  refFix: string | null
  predictedIawpAt: string | null
  source: string
  reason: string | null
}

type DisplayInboundRow = {
  id: string
  airport: AirportCode
  callsign: string
  aircraft: string
  refFix: string
  eta: string | null
  title: string
  planningState: PlanningState
}

type DemoSpec = {
  callsign: string
  aircraftType: string
  wakeTurbulence: string
  refFix: string
  naturalLandingOffsetMinutes: number
}

type DragState = {
  id: string
  pointerId: number
  startY: number
  startTldtMs: number
}

type RunwayProfile = {
  id: string
  modes: Record<string, RunwayMode>
}

const RUNWAYS: Record<AirportCode, readonly string[]> = {
  VTBD: ['21R', '21L'],
  VTBS: ['19', '20L', '20R'],
}

const ENTRY_FIXES: Record<AirportCode, readonly string[]> = {
  VTBD: ['WEHHA', 'NAKON', 'ENDUU', 'SEHNA', 'SABAI'],
  VTBS: ['WILLA', 'NORTA', 'EASTE', 'TUMGA', 'LEBIM'],
}

const RUNWAY_PROFILES: Record<AirportCode, readonly RunwayProfile[]> = {
  VTBD: [
    { id: 'DUAL_21RARR_21LARR', modes: { '21R': 'ARR', '21L': 'ARR' } },
    { id: '21RARR_21LDEP', modes: { '21R': 'ARR', '21L': 'DEP' } },
    { id: '21LARR_21RDEP', modes: { '21R': 'DEP', '21L': 'ARR' } },
  ],
  VTBS: [
    { id: 'SEMI35_19MIX_20LDEP_20RARR', modes: { '19': 'MIX', '20L': 'DEP', '20R': 'ARR' } },
    { id: '19ARR_20LDEP_20RARR', modes: { '19': 'ARR', '20L': 'DEP', '20R': 'ARR' } },
    { id: 'TRIPLE_19ARR_20LARR_20RARR', modes: { '19': 'ARR', '20L': 'ARR', '20R': 'ARR' } },
    { id: '20RARR_ONLY', modes: { '19': 'DEP', '20L': 'DEP', '20R': 'ARR' } },
  ],
}

const DEFAULT_PROFILE: Record<AirportCode, string> = {
  VTBD: 'DUAL_21RARR_21LARR',
  VTBS: 'SEMI35_19MIX_20LDEP_20RARR',
}

const DEFAULT_RUNWAY_MODES: Record<AirportCode, Record<string, RunwayMode>> = {
  VTBD: { '21R': 'ARR', '21L': 'ARR' },
  VTBS: { '19': 'MIX', '20L': 'DEP', '20R': 'ARR' },
}

const DEFAULT_SPACING_NM: Record<string, number> = {
  'VTBD:21R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21R'],
  'VTBD:21L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21L'],
  'VTBS:19': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['19'],
  'VTBS:20L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20L'],
  'VTBS:20R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20R'],
}

const DEMO_SPECS: Record<AirportCode, readonly DemoSpec[]> = {
  VTBD: [
    { callsign: 'THA101', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'WEHHA', naturalLandingOffsetMinutes: 8 },
    { callsign: 'AIQ202', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'NAKON', naturalLandingOffsetMinutes: 8.5 },
    { callsign: 'BKP303', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'ENDUU', naturalLandingOffsetMinutes: 9 },
    { callsign: 'TVJ404', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'SABAI', naturalLandingOffsetMinutes: 9.5 },
    { callsign: 'HVN505', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'SEHNA', naturalLandingOffsetMinutes: 10 },
    { callsign: 'THA606', aircraftType: 'A388', wakeTurbulence: 'J', refFix: 'WEHHA', naturalLandingOffsetMinutes: 11 },
    { callsign: 'AIQ707', aircraftType: 'AT76', wakeTurbulence: 'M', refFix: 'NAKON', naturalLandingOffsetMinutes: 13 },
    { callsign: 'KMI808', aircraftType: 'B763', wakeTurbulence: 'H', refFix: 'ENDUU', naturalLandingOffsetMinutes: 16 },
  ],
  VTBS: [
    { callsign: 'THA111', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'WILLA', naturalLandingOffsetMinutes: 8 },
    { callsign: 'AIQ222', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'NORTA', naturalLandingOffsetMinutes: 8.5 },
    { callsign: 'BKP333', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'EASTE', naturalLandingOffsetMinutes: 9 },
    { callsign: 'TVJ444', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'TUMGA', naturalLandingOffsetMinutes: 9.5 },
    { callsign: 'HVN555', aircraftType: 'A321', wakeTurbulence: 'M', refFix: 'LEBIM', naturalLandingOffsetMinutes: 10 },
    { callsign: 'THA666', aircraftType: 'A388', wakeTurbulence: 'J', refFix: 'WILLA', naturalLandingOffsetMinutes: 11 },
    { callsign: 'AIQ777', aircraftType: 'AT76', wakeTurbulence: 'M', refFix: 'NORTA', naturalLandingOffsetMinutes: 13 },
    { callsign: 'KMI888', aircraftType: 'B763', wakeTurbulence: 'H', refFix: 'EASTE', naturalLandingOffsetMinutes: 16 },
  ],
}

const PX_PER_MINUTE = 10
const TIMELINE_PAST_MINUTES = 22
const TIMELINE_FUTURE_MINUTES = 58
const DRAG_SNAP_MS = 15_000
const PLANNING_HORIZON_MINUTES = 40
const LATE_INSERT_MARGIN_MS = 15_000
// Project working rule for VTBS multi-runway sequencing: landing targets on different
// active arrival runways are staggered by at least one minute. This is deliberately
// separate from the per-runway NM landing spacing and can be made configurable later.
const VTBS_CROSS_RUNWAY_STAGGER_SECONDS = 60
const routeGeometryCache = new Map<string, Promise<RouteGeometry | null>>()

function scopeAirports(scope: AirportScope): AirportCode[] {
  return scope === 'BOTH' ? ['VTBD', 'VTBS'] : [scope]
}

function spacingKey(airport: AirportCode, runway: string) {
  return `${airport}:${runway}`
}

function rowAirport(id: string): AirportCode {
  if (id.startsWith('demo:VTBS:') || id.startsWith('VTBS:')) return 'VTBS'
  return 'VTBD'
}

function formatUtc(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`
}

function formatHm(value: string | null) {
  if (!value) return '--:--'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function formatDelay(minutes: number) {
  const rounded = Math.round(minutes * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}`
}

function nominalStarSeconds(airport: AirportCode, fix: string) {
  if (airport === 'VTBD') {
    const minutes = (VTBD_IAWP_NOMINAL_MINUTES as Record<string, number>)[fix]
    return Number.isFinite(minutes) ? minutes * 60 : null
  }
  const minutes = (VTBS_STAR19_NOMINAL_MINUTES as Record<string, number>)[fix]
  return Number.isFinite(minutes) ? minutes * 60 : null
}

function compactFix(airport: AirportCode, fix: string) {
  if (airport === 'VTBD') {
    return (VTBD_IAWP_COMPACT_CODES as Record<string, string>)[fix] || fix.slice(0, 1)
  }
  return fix.slice(0, 1)
}

function compactFixClass(airport: AirportCode, fix: string) {
  if (airport !== 'VTBD') return ''
  return (VTBD_IAWP_COMPACT_CODE_STYLE as Record<string, string>)[fix] === 'UNDERLINE' ? 'is-underlined' : ''
}

function timelineTicks(now: Date) {
  const anchor = new Date(now)
  anchor.setUTCSeconds(0, 0)
  return Array.from({ length: TIMELINE_PAST_MINUTES + TIMELINE_FUTURE_MINUTES + 1 }, (_, index) => {
    const tick = new Date(anchor.getTime() + (index - TIMELINE_PAST_MINUTES) * 60_000)
    const offsetMinutes = (tick.getTime() - now.getTime()) / 60_000
    return { key: tick.toISOString(), label: formatHm(tick.toISOString()), isMajor: tick.getUTCMinutes() % 5 === 0, offsetPx: Math.round(-offsetMinutes * PX_PER_MINUTE) }
  })
}

function routeKey(flight: IvaoArrivalTrafficFlight, airport: AirportCode) {
  if (!flight.departure || !flight.route) return null
  return `${flight.departure}|${airport}|${flight.route}`
}

function resolveRouteGeometry(flight: IvaoArrivalTrafficFlight, airport: AirportCode) {
  const key = routeKey(flight, airport)
  if (!key || !flight.departure || !flight.route) return Promise.resolve<RouteGeometry | null>(null)
  const existing = routeGeometryCache.get(key)
  if (existing) return existing
  const request = readRouteGeometry<RouteGeometry>(flight.departure, airport, flight.route).catch(() => { routeGeometryCache.delete(key); return null })
  routeGeometryCache.set(key, request)
  return request
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => value * Math.PI / 180
  const earthRadiusNm = 3440.065
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function buildDemoPredictions(airport: AirportCode, anchor: Date) {
  return DEMO_SPECS[airport].flatMap<AmanArrivalPrediction>((spec, index) => {
    const nominalSeconds = nominalStarSeconds(airport, spec.refFix)
    if (nominalSeconds == null) return []
    const naturalLandingMs = anchor.getTime() + spec.naturalLandingOffsetMinutes * 60_000
    return [{ id: `demo:${airport}:${index}`, callsign: spec.callsign, aircraftType: spec.aircraftType, wakeTurbulence: spec.wakeTurbulence, runway: '', refFix: spec.refFix, predictedIawpAt: new Date(naturalLandingMs - nominalSeconds * 1000).toISOString(), nominalStarSeconds: nominalSeconds }]
  })
}

function isArrivalMode(mode: RunwayMode) {
  return mode === 'ARR' || mode === 'MIX'
}

function activeRunwaysForAirport(airport: AirportCode, runwayModes: Record<AirportCode, Record<string, RunwayMode>>) {
  return RUNWAYS[airport].filter((runway) => isArrivalMode(runwayModes[airport][runway]))
}

function naturalLandingTimeMs(prediction: Pick<AmanArrivalPrediction, 'predictedIawpAt' | 'nominalStarSeconds'>) {
  return new Date(prediction.predictedIawpAt).getTime() + Math.max(0, prediction.nominalStarSeconds) * 1000
}

function isWithinPlanningHorizon(prediction: AmanArrivalPrediction, nowMs: number) {
  const iAwpMs = new Date(prediction.predictedIawpAt).getTime()
  return Number.isFinite(iAwpMs) && iAwpMs - nowMs <= PLANNING_HORIZON_MINUTES * 60_000
}

function isAtrType(value: string | null) {
  const type = String(value || '').trim().toUpperCase()
  return type.startsWith('AT7') || type.startsWith('ATR')
}

function pairwiseLandingSeparationSeconds(
  leader: AmanArrivalPrediction,
  follower: AmanArrivalPrediction,
  runwayBaseSeconds: number,
) {
  let required = Math.max(0, runwayBaseSeconds)
  const leaderType = String(leader.aircraftType || '').trim().toUpperCase()
  const leaderWake = String(leader.wakeTurbulence || '').trim().toUpperCase()

  // Current Thailand project working values supplied by the operational SME:
  // A380: at least 3 minutes / about 7 NM. ATR operation: 4 minutes / about 10 NM.
  // Keep the runway-configured base as the floor and only increase it when a pair rule applies.
  if (leaderWake === 'J' || leaderType === 'A388') {
    required = Math.max(required, AMAN_SPECIAL_SEPARATION_MINUTES.A380 * 60)
  }
  if (isAtrType(leader.aircraftType) || isAtrType(follower.aircraftType)) {
    required = Math.max(required, AMAN_SPECIAL_SEPARATION_MINUTES.ATR * 60)
  }
  return required
}

function candidateLandingTime(
  airport: AirportCode,
  runway: string,
  naturalMs: number,
  lastTargetByRunway: Map<string, number>,
  spacingNm: Record<string, number>,
) {
  const sameRunwaySpacingMs = nmToMinutesAtReferenceSpeed(spacingNm[spacingKey(airport, runway)] ?? 5) * 60_000
  let candidate = naturalMs
  const previousSameRunway = lastTargetByRunway.get(runway)
  if (previousSameRunway != null) candidate = Math.max(candidate, previousSameRunway + sameRunwaySpacingMs)

  if (airport === 'VTBS') {
    for (const [otherRunway, previousOtherRunway] of lastTargetByRunway.entries()) {
      if (otherRunway === runway) continue
      candidate = Math.max(candidate, previousOtherRunway + VTBS_CROSS_RUNWAY_STAGGER_SECONDS * 1000)
    }
  }

  return candidate
}

function assignPredictionsToRunways(
  predictions: AmanArrivalPrediction[],
  airport: AirportCode,
  runwayModes: Record<AirportCode, Record<string, RunwayMode>>,
  spacingNm: Record<string, number>,
  manualRunways: Record<string, string>,
) {
  const activeRunways = activeRunwaysForAirport(airport, runwayModes)
  if (!activeRunways.length) return []

  const lastTargetByRunway = new Map<string, number>()
  const ordered = [...predictions].sort((a, b) => naturalLandingTimeMs(a) - naturalLandingTimeMs(b) || a.callsign.localeCompare(b.callsign))

  return ordered.map((prediction) => {
    const naturalMs = naturalLandingTimeMs(prediction)
    const requestedRunway = manualRunways[prediction.id]
    const forcedRunway = requestedRunway && activeRunways.includes(requestedRunway) ? requestedRunway : null

    let bestRunway = forcedRunway ?? activeRunways[0]
    let bestTarget = candidateLandingTime(airport, bestRunway, naturalMs, lastTargetByRunway, spacingNm)

    if (!forcedRunway) {
      for (const runway of activeRunways.slice(1)) {
        const candidate = candidateLandingTime(airport, runway, naturalMs, lastTargetByRunway, spacingNm)
        if (candidate < bestTarget) {
          bestRunway = runway
          bestTarget = candidate
        }
      }
    }

    lastTargetByRunway.set(bestRunway, bestTarget)
    return { ...prediction, runway: bestRunway }
  })
}

function applyManualTargetsWithCascade(
  rows: AmanSequenceRow[],
  manualTldt: Record<string, string>,
  runwaySpacingSeconds: Record<string, number>,
) {
  const targetById = new Map<string, number>()
  rows.forEach((row) => targetById.set(row.id, new Date(manualTldt[row.id] ?? row.tldt).getTime()))

  const maxPasses = Math.max(4, rows.length * 4)
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false

    const byAirportRunway = new Map<string, AmanSequenceRow[]>()
    rows.forEach((row) => {
      const key = `${rowAirport(row.id)}:${row.runway}`
      const bucket = byAirportRunway.get(key) ?? []
      bucket.push(row)
      byAirportRunway.set(key, bucket)
    })

    for (const runwayRows of byAirportRunway.values()) {
      const ordered = [...runwayRows].sort((a, b) => a.sequenceIndex - b.sequenceIndex)
      let previousTargetMs: number | null = null
      let previousRow: AmanSequenceRow | null = null
      for (const row of ordered) {
        let targetMs = targetById.get(row.id) ?? new Date(row.tldt).getTime()
        if (previousTargetMs != null && previousRow) {
          const baseSeconds = Math.max(0, runwaySpacingSeconds[row.runway] ?? 0)
          const requiredSeconds = pairwiseLandingSeparationSeconds(previousRow, row, baseSeconds)
          const earliest = previousTargetMs + requiredSeconds * 1000
          if (targetMs < earliest) {
            targetMs = earliest
            targetById.set(row.id, targetMs)
            changed = true
          }
        }
        previousTargetMs = targetMs
        previousRow = row
      }
    }

    const vtbsRows = rows
      .filter((row) => rowAirport(row.id) === 'VTBS')
      .sort((a, b) => (targetById.get(a.id) ?? 0) - (targetById.get(b.id) ?? 0) || a.sequenceIndex - b.sequenceIndex)

    for (let index = 1; index < vtbsRows.length; index += 1) {
      const leader = vtbsRows[index - 1]
      const follower = vtbsRows[index]
      if (leader.runway === follower.runway) continue
      const leaderTarget = targetById.get(leader.id) ?? new Date(leader.tldt).getTime()
      const followerTarget = targetById.get(follower.id) ?? new Date(follower.tldt).getTime()
      const earliest = leaderTarget + VTBS_CROSS_RUNWAY_STAGGER_SECONDS * 1000
      if (followerTarget < earliest) {
        targetById.set(follower.id, earliest)
        changed = true
      }
    }

    if (!changed) break
  }

  return rows
    .map((row) => {
      const targetMs = targetById.get(row.id) ?? new Date(row.tldt).getTime()
      const metrics = calculateArrivalMetrics(row, new Date(targetMs).toISOString())
      return {
        ...metrics,
        sequenceIndex: row.sequenceIndex,
        autoShiftSeconds: Math.max(0, Math.round((targetMs - new Date(metrics.naturalLandingAt).getTime()) / 1000)),
      } satisfies AmanSequenceRow
    })
    .sort((a, b) => new Date(a.tldt).getTime() - new Date(b.tldt).getTime() || a.callsign.localeCompare(b.callsign))
    .map((row, index) => ({ ...row, sequenceIndex: index + 1 }))
}

export default function App() {
  const user = useAuthUser()
  const [now, setNow] = useState(() => new Date())
  const [airportScope, setAirportScope] = useState<AirportScope>('VTBD')
  const [runwayModes, setRunwayModes] = useState<Record<AirportCode, Record<string, RunwayMode>>>(() => ({ VTBD: { ...DEFAULT_RUNWAY_MODES.VTBD }, VTBS: { ...DEFAULT_RUNWAY_MODES.VTBS } }))
  const [profileByAirport, setProfileByAirport] = useState<Record<AirportCode, string>>({ ...DEFAULT_PROFILE })
  const [spacingNm, setSpacingNm] = useState<Record<string, number>>({ ...DEFAULT_SPACING_NM })
  const [historyMinutes, setHistoryMinutes] = useState(AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES)
  const [inbound, setInbound] = useState<InboundPreview[]>([])
  const [livePredictions, setLivePredictions] = useState<AmanArrivalPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoAnchor, setDemoAnchor] = useState<Date | null>(null)
  const [manualTldt, setManualTldt] = useState<Record<string, string>>({})
  const [manualRunways, setManualRunways] = useState<Record<string, string>>({})
  const [stableIds, setStableIds] = useState<Record<string, true>>({})
  const [latePendingIds, setLatePendingIds] = useState<Record<string, true>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const seenInboundIdsRef = useRef<Set<string>>(new Set())
  const initializedAirportsRef = useRef<Set<AirportCode>>(new Set())
  const latePendingIdsRef = useRef<Record<string, true>>({})
  const liveSequenceRef = useRef<AmanSequenceRow[]>([])

  const airports = useMemo(() => scopeAirports(airportScope), [airportScope])
  const ticks = useMemo(() => timelineTicks(now), [now])
  const planningNowMs = Math.floor(now.getTime() / 60_000) * 60_000
  const runwaySpacingSeconds = useMemo(() => {
    const result: Record<string, number> = {}
    for (const airport of ['VTBD', 'VTBS'] as const) {
      for (const runway of RUNWAYS[airport]) {
        result[runway] = nmToMinutesAtReferenceSpeed(spacingNm[spacingKey(airport, runway)] ?? 5) * 60
      }
    }
    return result
  }, [spacingNm])

  const activeArrivalRunways = useMemo(() => airports.flatMap((airport) =>
    activeRunwaysForAirport(airport, runwayModes).map((runway) => ({ airport, runway })),
  ), [airports, runwayModes])

  const liveSequencedPredictions = useMemo(() => livePredictions.filter((prediction) =>
    isWithinPlanningHorizon(prediction, planningNowMs) && !latePendingIds[prediction.id]
  ), [latePendingIds, livePredictions, planningNowMs])

  const liveBaseSequence = useMemo(() => {
    const assigned = airports.flatMap((airport) => assignPredictionsToRunways(
      liveSequencedPredictions.filter((prediction) => rowAirport(prediction.id) === airport),
      airport,
      runwayModes,
      spacingNm,
      manualRunways,
    ))
    return autoSequenceUnstableArrivals(assigned, {
      runwaySpacingSeconds,
      pairwiseSeparationSeconds: pairwiseLandingSeparationSeconds,
    })
  }, [airports, liveSequencedPredictions, manualRunways, runwayModes, runwaySpacingSeconds, spacingNm])

  const demoBaseSequence = useMemo(() => {
    if (!demoMode || !demoAnchor) return []
    const assigned = airports.flatMap((airport) => assignPredictionsToRunways(
      buildDemoPredictions(airport, demoAnchor),
      airport,
      runwayModes,
      spacingNm,
      manualRunways,
    ))
    return autoSequenceUnstableArrivals(assigned, {
      runwaySpacingSeconds,
      pairwiseSeparationSeconds: pairwiseLandingSeparationSeconds,
    })
  }, [airports, demoAnchor, demoMode, manualRunways, runwayModes, runwaySpacingSeconds, spacingNm])

  const demoSequence = useMemo(
    () => applyManualTargetsWithCascade(demoBaseSequence, manualTldt, runwaySpacingSeconds),
    [demoBaseSequence, manualTldt, runwaySpacingSeconds],
  )
  const liveSequence = useMemo(
    () => applyManualTargetsWithCascade(liveBaseSequence, manualTldt, runwaySpacingSeconds),
    [liveBaseSequence, manualTldt, runwaySpacingSeconds],
  )
  liveSequenceRef.current = liveSequence

  const activeSequence = demoMode ? demoSequence : liveSequence
  const liveRouteCount = useMemo(() => inbound.filter((item) => item.source === 'LIVE_ROUTE').length, [inbound])
  const liveTmaCount = useMemo(() => inbound.filter(({ flight }) => Number.isFinite(flight.latitude) && Number.isFinite(flight.longitude) && distanceNm(BKK_VOR_COORDINATES.lat, BKK_VOR_COORDINATES.lon, flight.latitude as number, flight.longitude as number) <= BANGKOK_TMA_WORKING_RADIUS_NM).length, [inbound])
  const averageDelay = useMemo(() => averageDelayMinutes(activeSequence), [activeSequence])
  const visibleSequence = useMemo(() => {
    const cutoff = now.getTime() - historyMinutes * 60_000
    return activeSequence.filter((row) => new Date(row.tldt).getTime() >= cutoff)
  }, [activeSequence, historyMinutes, now])

  const separationConflictIds = useMemo(() => {
    const conflicts = new Set<string>()
    const previousByAirportRunway = new Map<string, AmanSequenceRow>()
    const ordered = [...activeSequence].sort((a, b) => new Date(a.tldt).getTime() - new Date(b.tldt).getTime())
    for (const row of ordered) {
      const airport = rowAirport(row.id)
      const key = `${airport}:${row.runway}`
      const previous = previousByAirportRunway.get(key)
      if (previous) {
        const gapMs = new Date(row.tldt).getTime() - new Date(previous.tldt).getTime()
        const baseSeconds = Math.max(0, runwaySpacingSeconds[row.runway] ?? 0)
        const requiredSeconds = pairwiseLandingSeparationSeconds(previous, row, baseSeconds)
        if (gapMs + 500 < requiredSeconds * 1000) {
          conflicts.add(previous.id)
          conflicts.add(row.id)
        }
      }
      previousByAirportRunway.set(key, row)
    }

    const vtbsRows = ordered.filter((row) => rowAirport(row.id) === 'VTBS')
    for (let index = 1; index < vtbsRows.length; index += 1) {
      const leader = vtbsRows[index - 1]
      const follower = vtbsRows[index]
      if (leader.runway === follower.runway) continue
      const gapMs = new Date(follower.tldt).getTime() - new Date(leader.tldt).getTime()
      if (gapMs + 500 < VTBS_CROSS_RUNWAY_STAGGER_SECONDS * 1000) {
        conflicts.add(leader.id)
        conflicts.add(follower.id)
      }
    }

    return conflicts
  }, [activeSequence, runwaySpacingSeconds])

  const livePredictionById = useMemo(() => new Map(livePredictions.map((prediction) => [prediction.id, prediction])), [livePredictions])
  const displayInboundRows = useMemo<DisplayInboundRow[]>(() => demoMode
    ? demoSequence.map((row) => ({
        id: row.id,
        airport: rowAirport(row.id),
        callsign: row.callsign,
        aircraft: row.aircraftType || '----',
        refFix: row.refFix,
        eta: row.predictedIawpAt,
        title: stableIds[row.id] ? 'SIMULATED · ATC MANUAL / STABLE' : 'SIMULATED TEST TRAFFIC',
        planningState: 'SEQUENCED',
      }))
    : inbound.map((item) => {
        const prediction = livePredictionById.get(item.id)
        const planningState: PlanningState = latePendingIds[item.id]
          ? 'LATE'
          : prediction && isWithinPlanningHorizon(prediction, planningNowMs)
            ? 'SEQUENCED'
            : 'MONITORED'
        return {
          id: item.id,
          airport: item.airport,
          callsign: item.flight.callsign,
          aircraft: item.flight.aircraft || '----',
          refFix: item.refFix || '----',
          eta: item.predictedIawpAt,
          title: `${item.source}${stableIds[item.id] ? ' · ATC MANUAL / STABLE' : ''}${planningState === 'MONITORED' ? ` · MONITORED OUTSIDE ${PLANNING_HORIZON_MINUTES} MIN HORIZON` : ''}${planningState === 'LATE' ? ' · LATE INSERT PENDING ATC ACCEPTANCE' : ''}${item.reason ? ` · ${item.reason}` : ''}`,
          planningState,
        }
      }),
  [demoMode, demoSequence, inbound, latePendingIds, livePredictionById, planningNowMs, stableIds])

  const monitoredInboundCount = displayInboundRows.filter((item) => item.planningState === 'MONITORED').length
  const latePendingCount = displayInboundRows.filter((item) => item.planningState === 'LATE').length
  const displayTmaCount = demoMode ? Math.min(8, demoSequence.length) : liveTmaCount
  const displayTotCount = demoMode ? demoSequence.length : inbound.length

  const resetManualState = () => {
    setManualTldt({})
    setManualRunways({})
    setStableIds({})
    setDraggingId(null)
    dragRef.current = null
  }

  const setScope = (scope: AirportScope) => {
    resetManualState()
    setAirportScope(scope)
  }

  const applyProfile = (airport: AirportCode, profileId: string) => {
    const profile = RUNWAY_PROFILES[airport].find((item) => item.id === profileId)
    if (!profile) return
    resetManualState()
    setProfileByAirport((current) => ({ ...current, [airport]: profileId }))
    setRunwayModes((current) => ({ ...current, [airport]: { ...current[airport], ...profile.modes } }))
  }

  const setRunwayMode = (airport: AirportCode, runway: string, mode: RunwayMode) => {
    resetManualState()
    setProfileByAirport((current) => ({ ...current, [airport]: 'CUSTOM' }))
    setRunwayModes((current) => ({ ...current, [airport]: { ...current[airport], [runway]: mode } }))
  }

  const setRunwaySpacing = (airport: AirportCode, runway: string, value: number) => {
    if (Number.isFinite(value) && value > 0) {
      setSpacingNm((current) => ({ ...current, [spacingKey(airport, runway)]: value }))
    }
  }

  const acceptLateInsert = (id: string) => {
    setLatePendingIds((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      latePendingIdsRef.current = next
      return next
    })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let disposed = false
    const loadTraffic = async () => {
      setLoading(true)
      const results = await Promise.all(airports.map(async (airport) => {
        try {
          const payload = await readIvaoTraffic(airport)
          const resolved = await Promise.all((payload.flights ?? []).map(async (flight) => {
            const id = `${airport}:${flight.sessionId}`
            const match = findAipIawp(airport, flight.route, [...ENTRY_FIXES[airport]])
            if (!match) return { preview: { airport, id, flight, refFix: null, predictedIawpAt: null, source: 'UNRESOLVED', reason: 'IAWP not resolved from filed route' } satisfies InboundPreview, prediction: null }
            const nominalSeconds = nominalStarSeconds(airport, match.entryFix)
            if (nominalSeconds == null) return { preview: { airport, id, flight, refFix: match.entryFix, predictedIawpAt: null, source: 'NO TIMING', reason: 'No nominal STAR timing configured' } satisfies InboundPreview, prediction: null }
            const geometry = await resolveRouteGeometry(flight, airport)
            const eta = estimateIawpArrival(flight, geometry, match.entryFix, nominalSeconds, payload.fetchedAt)
            const preview = { airport, id, flight, refFix: match.entryFix, predictedIawpAt: eta.predictedIawpAt, source: eta.source, reason: eta.reason } satisfies InboundPreview
            const prediction: AmanArrivalPrediction | null = eta.predictedIawpAt ? {
              id,
              callsign: flight.callsign,
              aircraftType: flight.aircraft,
              wakeTurbulence: flight.wakeTurbulence,
              runway: '',
              refFix: match.entryFix,
              predictedIawpAt: eta.predictedIawpAt,
              nominalStarSeconds: nominalSeconds,
            } : null
            return { preview, prediction }
          }))
          return { airport, payload, resolved, error: null as string | null }
        } catch (error) {
          return { airport, payload: null, resolved: [], error: error instanceof Error ? error.message : String(error) }
        }
      }))

      if (disposed) return
      const previews = results.flatMap((result) => result.resolved.map((item) => item.preview))
      const predictions = results.flatMap((result) => result.resolved.map((item) => item.prediction).filter((item): item is AmanArrivalPrediction => item !== null))
      const errors = results.filter((result) => result.error).map((result) => `${result.airport}: ${result.error}`)
      const fetchedTimes = results.map((result) => result.payload?.fetchedAt).filter((value): value is string => Boolean(value)).sort()

      const activeIds = new Set(previews.map((item) => item.id))
      const nextLatePending: Record<string, true> = { ...latePendingIdsRef.current }
      for (const id of Object.keys(nextLatePending)) {
        if (!activeIds.has(id)) delete nextLatePending[id]
      }

      const nowMs = Date.now()
      for (const result of results) {
        const wasInitialized = initializedAirportsRef.current.has(result.airport)
        if (wasInitialized) {
          const latestExistingTarget = liveSequenceRef.current
            .filter((row) => rowAirport(row.id) === result.airport)
            .reduce((latest, row) => Math.max(latest, new Date(row.tldt).getTime()), Number.NEGATIVE_INFINITY)

          for (const item of result.resolved) {
            const prediction = item.prediction
            if (!prediction || seenInboundIdsRef.current.has(prediction.id) || !isWithinPlanningHorizon(prediction, nowMs)) continue
            const naturalMs = naturalLandingTimeMs(prediction)
            if (Number.isFinite(latestExistingTarget) && naturalMs < latestExistingTarget - LATE_INSERT_MARGIN_MS) {
              nextLatePending[prediction.id] = true
            }
          }
        }
        initializedAirportsRef.current.add(result.airport)
      }

      previews.forEach((item) => seenInboundIdsRef.current.add(item.id))
      latePendingIdsRef.current = nextLatePending
      setLatePendingIds(nextLatePending)
      setInbound(previews.sort((a, b) => (a.predictedIawpAt || '9999').localeCompare(b.predictedIawpAt || '9999')))
      setLivePredictions(predictions)
      setFetchedAt(fetchedTimes.at(-1) ?? null)
      setTrafficError(errors.length ? errors.join(' · ') : null)
      setLoading(false)
    }

    void loadTraffic()
    const refresh = window.setInterval(() => void loadTraffic(), 30_000)
    return () => {
      disposed = true
      window.clearInterval(refresh)
    }
  }, [airports])

  const toggleDemo = () => {
    resetManualState()
    if (demoMode) {
      setDemoMode(false)
      setDemoAnchor(null)
      return
    }
    setDemoAnchor(new Date())
    setDemoMode(true)
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, row: AmanSequenceRow) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: row.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTldtMs: new Date(row.tldt).getTime(),
    }
    setDraggingId(row.id)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>, row: AmanSequenceRow) => {
    const drag = dragRef.current
    if (!drag || drag.id !== row.id || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const rawTargetMs = drag.startTldtMs + (-(event.clientY - drag.startY) / PX_PER_MINUTE) * 60_000
    const snappedTargetMs = Math.round(rawTargetMs / DRAG_SNAP_MS) * DRAG_SNAP_MS
    setManualTldt((current) => ({ ...current, [row.id]: new Date(snappedTargetMs).toISOString() }))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, row: AmanSequenceRow) => {
    const drag = dragRef.current
    if (!drag || drag.id !== row.id || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDraggingId(null)
    setStableIds((current) => ({ ...current, [row.id]: true }))
  }

  const setFlightRunway = (row: AmanSequenceRow, runway: string) => {
    const airport = rowAirport(row.id)
    if (!activeRunwaysForAirport(airport, runwayModes).includes(runway)) return
    setManualRunways((current) => ({ ...current, [row.id]: runway }))
    setManualTldt((current) => current[row.id] ? current : ({ ...current, [row.id]: row.tldt }))
    setStableIds((current) => ({ ...current, [row.id]: true }))
  }

  const resetRow = (row: AmanSequenceRow) => {
    setManualTldt((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    setManualRunways((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    setStableIds((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
  }

  const configSummary = activeArrivalRunways.length
    ? activeArrivalRunways.map(({ airport, runway }) => `${airport === 'VTBD' ? 'BD' : 'BS'}${runway} ${spacingNm[spacingKey(airport, runway)].toFixed(1)}NM`).join(' · ')
    : 'NO ARRIVAL RUNWAY'

  return <div className={`aman-app${airportScope === 'BOTH' ? ' scope-both' : ''}`}>
    <header className="aman-topbar">
      <div className="aman-brand">
        <img src={ivaoThailandLogo} alt="IVAO Thailand" />
        <div className="aman-brand-copy"><span>Thailand Approach AMAN</span><strong>Arrival Sequencing</strong></div>
      </div>
      <div className="aman-session">
        <div className="aman-clock"><span>UTC</span><strong>{formatUtc(now)}</strong></div>
        <div className="aman-user"><strong>{user.name}</strong><span>VID {user.vid}</span></div>
        <a className="aman-signout" href="/api/auth/logout">Sign out</a>
      </div>
    </header>

    <section className="aman-control-strip aman-multi-runway-strip">
      <div className="aman-airport-tabs" aria-label="Airport selector">
        {(['VTBD', 'VTBS', 'BOTH'] as const).map((code) => <button key={code} type="button" className={airportScope === code ? 'is-active' : ''} onClick={() => setScope(code)}>{code}</button>)}
      </div>
      <div className="aman-runway-config-control">
        {airports.map((airport) => <div className="aman-runway-config-block" key={airport}>
          <label className="aman-profile-select">
            <span>{airport} CONFIG</span>
            <select value={profileByAirport[airport]} onChange={(event) => applyProfile(airport, event.target.value)}>
              {profileByAirport[airport] === 'CUSTOM' && <option value="CUSTOM">CUSTOM</option>}
              {RUNWAY_PROFILES[airport].map((profile) => <option key={profile.id} value={profile.id}>{profile.id}</option>)}
            </select>
          </label>
          <div className="aman-runway-cards">
            {RUNWAYS[airport].map((runway) => {
              const mode = runwayModes[airport][runway]
              const arrivalEnabled = isArrivalMode(mode)
              return <div className={`aman-runway-card ${arrivalEnabled ? 'is-arrival' : ''}`} key={runway}>
                <b>{runway}</b>
                <select value={mode} onChange={(event) => setRunwayMode(airport, runway, event.target.value as RunwayMode)}>
                  <option value="ARR">ARR</option><option value="DEP">DEP</option><option value="MIX">MIX</option><option value="CLOSED">CLOSED</option>
                </select>
                <label title="Target landing spacing">
                  <input type="number" min="1" max="20" step="0.1" value={spacingNm[spacingKey(airport, runway)]} disabled={!arrivalEnabled} onChange={(event) => setRunwaySpacing(airport, runway, Number(event.target.value))} />
                  <span>NM</span>
                </label>
              </div>
            })}
          </div>
        </div>)}
      </div>
      <div className="aman-config-label"><span>APPROACH VIEW</span><strong>{configSummary}</strong></div>
      <div className="aman-counters">
        <div><span>TMA</span><strong>{String(displayTmaCount).padStart(3, '0')}</strong></div>
        <div><span>TOT</span><strong>{String(displayTotCount).padStart(3, '0')}</strong></div>
        <div><span>HLD</span><strong>---</strong></div>
        <div><span>ΔT</span><strong>{activeSequence.length ? formatDelay(averageDelay) : '--'}</strong></div>
      </div>
    </section>

    <main className="aman-workspace">
      <section className="aman-panel aman-timeline-panel">
        <div className="aman-panel-header">
          <div><span className="aman-eyebrow">MAESTRO STYLE</span><h1>Arrival Timeline</h1></div>
          <div className="aman-panel-meta">
            <span>5 MIN MAJOR</span><span>1 MIN MINOR</span><span>HORIZON {PLANNING_HORIZON_MINUTES} MIN</span>
            <label className="aman-history-control"><span>HISTORY</span><select value={historyMinutes} onChange={(event) => setHistoryMinutes(Number(event.target.value))}>{AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES.map((value) => <option key={value} value={value}>{value} MIN</option>)}</select></label>
            {latePendingCount > 0 && <span className="aman-late-alert">LATE INSERT {latePendingCount}</span>}
            <span className="is-drag-enabled">CASCADE DRAG · DBL CLICK RESET</span>
            <button type="button" className={`aman-demo-toggle ${demoMode ? 'is-active' : ''}`} onClick={toggleDemo}>{demoMode ? 'TEST TRAFFIC ON' : 'TEST TRAFFIC'}</button>
            <span className={demoMode ? 'is-simulated' : ''}>{demoMode ? 'SIMULATED' : loading ? 'LOADING' : 'IVAO LIVE'}</span>
          </div>
        </div>

        <div className="aman-timeline-stage">
          <div className="aman-time-axis" aria-hidden="true">{ticks.map((tick) => <div className={`aman-minute-tick ${tick.isMajor ? 'is-major' : 'is-minor'}`} key={tick.key} style={{ '--offset-px': `${tick.offsetPx}px` } as CSSProperties}>{tick.isMajor && <span>{tick.label}</span>}<i /></div>)}</div>
          <div className="aman-current-line"><span>ACTUAL {formatUtc(now)}</span></div>
          <div className="aman-flight-layer">
            {visibleSequence.map((row) => {
              const offsetMinutes = (new Date(row.tldt).getTime() - now.getTime()) / 60_000
              const isPast = offsetMinutes < 0
              const offsetPx = Math.round(-offsetMinutes * PX_PER_MINUTE)
              const isStable = Boolean(stableIds[row.id])
              const hasConflict = separationConflictIds.has(row.id)
              const isDragging = draggingId === row.id
              const airport = rowAirport(row.id)
              const selectableRunways = activeRunwaysForAirport(airport, runwayModes)
              const runwayLabel = airportScope === 'BOTH' ? `${airport === 'VTBD' ? 'BD' : 'BS'}/${row.runway}` : row.runway

              return <div
                key={row.id}
                className={`aman-flight-row action-${row.delayAction.toLowerCase()}${isPast ? ' is-past' : ''}${demoMode ? ' is-demo' : ''}${isStable ? ' is-stable' : ''}${hasConflict ? ' is-sep-conflict' : ''}${isDragging ? ' is-dragging' : ''}`}
                style={{ '--offset-px': `${offsetPx}px` } as CSSProperties}
                title={`Cascade drag sets TLDT · double-click to reset · Predicted IAWP ${formatHm(row.predictedIawpAt)}Z · TLDT ${formatHm(row.tldt)}Z · Delay ${formatDelay(row.delayMinutes)} min · ${airport} RWY ${row.runway}${isStable ? ' · ATC manual / Stable' : ''}${manualRunways[row.id] ? ' · MANUAL RUNWAY' : ''}${hasConflict ? ' · PAIRWISE SEPARATION INVARIANT FAILED' : ''}${isPast ? ' · assumed landed' : ''}`}
                onPointerDown={(event) => startDrag(event, row)}
                onPointerMove={(event) => moveDrag(event, row)}
                onPointerUp={(event) => endDrag(event, row)}
                onPointerCancel={(event) => endDrag(event, row)}
                onDoubleClick={() => resetRow(row)}
              >
                <span className="tldt">{formatHm(row.tldt)}</span>
                <strong>{row.callsign}</strong>
                <span>{row.aircraftType || '----'}</span>
                <span className={`fix-code ${compactFixClass(airport, row.refFix)}`}>{compactFix(airport, row.refFix)}</span>
                <span>{formatHm(row.tto)}</span>
                <b>{formatDelay(row.delayMinutes)}</b>
                <em className={`runway-assignment${manualRunways[row.id] ? ' is-manual' : ''}`}>
                  {selectableRunways.length > 1 ? <select
                    value={row.runway}
                    aria-label={`${row.callsign} landing runway`}
                    title={`Assign ${row.callsign} landing runway`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onChange={(event) => setFlightRunway(row, event.target.value)}
                  >
                    {selectableRunways.map((runway) => <option key={runway} value={runway}>{runway}</option>)}
                  </select> : runwayLabel}
                </em>
              </div>
            })}
          </div>
          {!loading && !visibleSequence.length && !demoMode && <div className="aman-empty-sequence">
            <strong>{trafficError ? 'LIVE TRAFFIC ERROR' : latePendingCount ? 'LATE INSERT AWAITING ATC' : monitoredInboundCount ? 'INBOUND OUTSIDE PLANNING HORIZON' : activeArrivalRunways.length ? 'NO SEQUENCEABLE INBOUND' : 'NO ARRIVAL RUNWAY ACTIVE'}</strong>
            <span>{trafficError || (latePendingCount ? `${latePendingCount} new inbound would enter an existing sequence. Accept it from the Inbound panel before resequencing.` : monitoredInboundCount ? `${monitoredInboundCount} inbound monitored. They enter the landing sequence at ${PLANNING_HORIZON_MINUTES} minutes to IAWP.` : activeArrivalRunways.length ? 'No live inbound inside the planning horizon right now. Use TEST TRAFFIC to verify sequencing.' : 'Set at least one runway to ARR or MIX.')}</span>
          </div>}
        </div>
      </section>

      <aside className="aman-side-stack">
        <section className="aman-panel aman-inbound-panel">
          <div className="aman-panel-header compact"><div><span className="aman-eyebrow">TRAFFIC</span><h2>Inbound</h2></div><span className={`aman-live-pill ${trafficError ? 'is-error' : ''} ${demoMode ? 'is-demo' : ''}`}>{demoMode ? 'TEST DATA' : trafficError ? 'API ERROR' : 'IVAO LIVE'}</span></div>
          <div className="aman-inbound-list">
            <div className="aman-inbound-head multi"><span>APT</span><span>ACID</span><span>TYPE</span><span>IAWP</span><span>ETA</span></div>
            {displayInboundRows.map((item) => <div className={`aman-inbound-row multi planning-${item.planningState.toLowerCase()}`} data-planning-state={item.planningState} key={item.id} title={item.title}>
              <span className="apt">{item.airport === 'VTBD' ? 'BD' : 'BS'}</span>
              <div className="aman-inbound-acid">
                <strong className={stableIds[item.id] ? 'is-stable' : ''}>{item.callsign}</strong>
                {item.planningState === 'MONITORED' && <small className="aman-planning-badge">MON</small>}
                {item.planningState === 'LATE' && <button type="button" className="aman-late-insert-button" onClick={() => acceptLateInsert(item.id)}>INSERT</button>}
              </div>
              <span>{item.aircraft}</span><span>{item.refFix}</span><span>{formatHm(item.eta)}</span>
            </div>)}
            {!loading && !displayInboundRows.length && <p>No connected inbound traffic for {airportScope}.</p>}
          </div>
        </section>

        <section className="aman-panel aman-system-panel">
          <div className="aman-panel-header compact"><div><span className="aman-eyebrow">SYSTEM</span><h2>Pipeline</h2></div></div>
          <dl className="aman-status-list">
            <div><dt>Data mode</dt><dd>{demoMode ? 'SIMULATED' : 'LIVE'}</dd></div>
            <div><dt>IVAO inbound</dt><dd>{trafficError ? 'PARTIAL / ERROR' : 'LIVE'}</dd></div>
            <div><dt>Airport scope</dt><dd>{airportScope}</dd></div>
            <div><dt>Arrival runways</dt><dd>{activeArrivalRunways.length}</dd></div>
            <div><dt>IAWP mapping</dt><dd>ACTIVE</dd></div>
            <div><dt>Planning horizon</dt><dd>{PLANNING_HORIZON_MINUTES} MIN</dd></div>
            <div><dt>Monitored inbound</dt><dd>{monitoredInboundCount}</dd></div>
            <div><dt>Late insert</dt><dd className={latePendingCount ? 'is-warning' : ''}>{latePendingCount ? `${latePendingCount} PENDING` : 'NONE'}</dd></div>
            <div><dt>Live route ETA</dt><dd>{liveRouteCount}/{inbound.length}</dd></div>
            <div><dt>Fallback ETA</dt><dd>ACTUAL / EOBT</dd></div>
            <div><dt>TMA model</dt><dd>50 NM BKK</dd></div>
            <div><dt>Sequence</dt><dd>CASCADE CONSTRAINED</dd></div>
            <div><dt>Pairwise SEP</dt><dd>ACTIVE</dd></div>
            <div><dt>Manual runway</dt><dd>{Object.keys(manualRunways).length}</dd></div>
            <div><dt>VTBS X-RWY</dt><dd>1.0 MIN</dd></div>
            <div><dt>Manual stable</dt><dd>{Object.keys(stableIds).length}</dd></div>
            <div><dt>SEP invariant</dt><dd className={separationConflictIds.size ? 'is-warning' : ''}>{separationConflictIds.size ? 'FAILED' : 'OK'}</dd></div>
            <div><dt>Last update</dt><dd>{formatHm(fetchedAt)}Z</dd></div>
          </dl>
        </section>
      </aside>
    </main>

    <footer className="aman-legend"><span>DELAY</span><i className="expedite" /> Expedite <i className="nothing" /> Nothing <i className="speed" /> Speed reduction <i className="stretch" /> Path stretching <i className="holding" /> Holding</footer>
  </div>
}
