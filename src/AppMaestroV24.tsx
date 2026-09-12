import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import AirportSelector from './AirportSelector'
import { VTBD_ALL_RUNWAYS, VTBD_RUNWAY_GROUPS, vtbdFlowFromWorkspace, vtbdModesForFlow, type VtbdFlow } from '../shared/vtbdRunways'
import { VTBS_ALL_RUNWAYS, VTBS_RUNWAY_GROUPS, vtbsFlowFromWorkspace, vtbsModesForFlow, type VtbsFlow } from '../shared/vtbsRunways'
import { AMAN_AIRPORTS, AIRPORT_REFERENCE, DEFAULT_AIRPORT_VIEW, airportFromId, isAmanAirport, isRegionalAirport, type AirportCode, type AirportView } from './core/airports'
import { registerRegionalFinalGeometry } from './finalTenNmRuntime'
import { readRegionalNav, readRegionalSnapshot } from './core/regionalPreviewData'
import type { RegionalNavPayload } from './core/regionalArrivalModel'
import { regionalPrediction, retainRegionalLock } from './core/regionalAmanAdapter'
import ivaoThailandLogo from './assets/ivao-thailand-logo.png'
import { useAuthUser } from './AuthGate'
import { findAipIawp } from './aipArrivalIawp'
import {
  AMAN_DEFAULT_RUNWAY_SPACING_NM,
  AMAN_ETA_FF_REFRESH_MS,
  AMAN_ETA_FF_REFRESH_SECONDS,
  AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES,
  AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES,
  AMAN_PROCESSING_RADIUS_BAND_NM,
  AMAN_PROCESSING_RADIUS_NM,
  AMAN_REFERENCE_AAR_PER_HOUR,
  AMAN_SPECIAL_SEPARATION_MINUTES,
  BANGKOK_TMA_WORKING_RADIUS_NM,
  BKK_VOR_COORDINATES,
  VTBD_IAWP_COMPACT_CODES,
  VTBD_IAWP_COMPACT_CODE_STYLE,
  VTBD_IAWP_NOMINAL_MINUTES,
  VTBD_STAR03_NOMINAL_MINUTES,
  VTBS_STAR19_NOMINAL_MINUTES,
  VTBS_STAR01_NOMINAL_MINUTES,
  getAmanOperationalMatrixAdvice,
  nmToMinutesAtReferenceSpeed,
  splitAmanDelay,
} from './core/amanConstants'
import { readAircraftPerformance, readIvaoTraffic, readOperationalConfig, readRouteGeometry, type IvaoArrivalTrafficFlight, type OperationalConfigPayload } from './core/api'
import { formatRoundedHmUtc } from './core/minuteRounding'
import { estimateIawpArrival, type RouteGeometry } from './core/arrivalEta'
import {
  amanSequenceOrderIdentity,
  autoSequenceUnstableArrivals,
  averageDelayMinutes,
  calculateArrivalMetrics,
  clearArrivalControllerDelayBaseline,
  resolveAmanPairwiseSeparationSeconds,
  type AmanArrivalPrediction,
  type AmanSequenceRow,
} from './core/arrivalSequencing'
import { TIMELINE_FUTURE_HORIZON_MINUTES } from './timelineScale'

type AirportScope = string
type RunwayMode = 'ARR' | 'DEP' | 'MIX' | 'CLOSED'
type OperationalState = 'NORMAL' | 'MISSED_APPROACH' | 'DESEQUENCED' | 'REMOVED'
type PlanningState = 'BOARDING' | 'DEPARTING' | 'TAKEOFF_EST' | 'SEQUENCED' | 'MONITORED' | 'MISSED' | 'DESEQUENCED' | 'REMOVED'

type InboundPreview = {
  airport: AirportCode
  id: string
  flight: IvaoArrivalTrafficFlight
  refFix: string | null
  predictedIawpAt: string | null
  source: string
  reason: string | null
  processingDistanceNm: number | null
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
  processingDistanceNm: number | null
  operationalState: OperationalState
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
  moved: boolean
}

type RunwayProfile = {
  id: string
  modes: Record<string, RunwayMode>
}

type SharedOperationalFlight = {
  airport: string
  callsign: string
  target_mode?: 'AUTO' | 'MANUAL' | null
  manual_runway?: string | null
  auto_return_tldt?: string | null
  auto_return_floor_tldt?: string | null
  auto_return_runway?: string | null
  auto_returned_at?: string | null
  frozen_tldt?: string | null
  frozen_runway?: string | null
  frozen_approach_category?: string | null
  frozen_distance_nm?: number | null
  frozen_path_distance_nm?: number | null
  frozen_approach_path?: string | null
  frozen_reference_speed_kt?: number | null
  frozen_track_at?: string | null
  frozen_captured_at?: string | null
  missed_approach_active?: boolean | null
  missed_approach_source?: 'MANUAL' | 'AUTO' | null
  missed_approach_detected_at?: string | null
  missed_approach_expires_at?: string | null
  operational_state?: OperationalState | null
  reserved_gap_seconds?: number | null
}

type SharedStateDetail = {
  flightStates?: SharedOperationalFlight[]
}

type OpsMenuState = {
  rowId: string
  x: number
  y: number
}

const RUNWAYS: Record<AirportCode, readonly string[]> = {
  VTBD: VTBD_ALL_RUNWAYS,
  VTBS: VTBS_ALL_RUNWAYS,
  VTCC: ['18', '36'], VTSP: ['09', '27'],
}

const ENTRY_FIXES: Record<AirportCode, readonly string[]> = {
  VTBD: ['WEHHA', 'NAKON', 'ENDUU', 'SEHNA', 'SABAI'],
  VTBS: ['WILLA', 'NORTA', 'EASTE', 'TUMGA', 'LEBIM'],
  VTCC: [], VTSP: [],
}

const RUNWAY_PROFILES: Record<AirportCode, readonly RunwayProfile[]> = {
  VTCC: [{ id: 'RWY 18', modes: { '18': 'ARR', '36': 'CLOSED' } }, { id: 'RWY 36', modes: { '18': 'CLOSED', '36': 'ARR' } }],
  VTSP: [{ id: 'RWY 09', modes: { '09': 'ARR', '27': 'CLOSED' } }, { id: 'RWY 27', modes: { '09': 'CLOSED', '27': 'ARR' } }],
  VTBD: [
    { id: 'DUAL_21RARR_21LARR', modes: { '21R': 'ARR', '21L': 'ARR' } },
    { id: '21RARR_21LDEP', modes: { '21R': 'ARR', '21L': 'DEP' } },
    { id: '21LARR_21RDEP', modes: { '21R': 'DEP', '21L': 'ARR' } },
    { id: 'DUAL_03LARR_03RARR', modes: { '03L': 'ARR', '03R': 'ARR' } },
    { id: '03LARR_03RDEP', modes: { '03L': 'ARR', '03R': 'DEP' } },
    { id: '03RARR_03LDEP', modes: { '03L': 'DEP', '03R': 'ARR' } },
  ],
  VTBS: [
    { id: 'SEMI35_19MIX_20LDEP_20RARR', modes: { '19': 'MIX', '20L': 'DEP', '20R': 'ARR' } },
    { id: '19ARR_20LDEP_20RARR', modes: { '19': 'ARR', '20L': 'DEP', '20R': 'ARR' } },
    { id: 'TRIPLE_19ARR_20LARR_20RARR', modes: { '19': 'ARR', '20L': 'ARR', '20R': 'ARR' } },
    { id: '20RARR_ONLY', modes: { '19': 'DEP', '20L': 'DEP', '20R': 'ARR' } },
    { id: 'SEMI35_01MIX_02RDEP_02LARR', modes: { '01': 'MIX', '02R': 'DEP', '02L': 'ARR' } },
    { id: '01ARR_02RDEP_02LARR', modes: { '01': 'ARR', '02R': 'DEP', '02L': 'ARR' } },
    { id: 'TRIPLE_01ARR_02LARR_02RARR', modes: { '01': 'ARR', '02L': 'ARR', '02R': 'ARR' } },
    { id: '02LARR_ONLY', modes: { '01': 'DEP', '02R': 'DEP', '02L': 'ARR' } },
  ],
}

const DEFAULT_PROFILE: Record<AirportCode, string> = {
  VTCC: 'RWY 18', VTSP: 'RWY 27',
  VTBD: 'DUAL_21RARR_21LARR',
  VTBS: 'SEMI35_19MIX_20LDEP_20RARR',
}

const RUNTIME_MASTER_FLOW: Record<AirportCode, string> = {
  VTCC: '18', VTSP: '27',
  VTBD: '21',
  VTBS: '19_20',
}

const DEFAULT_RUNWAY_MODES: Record<AirportCode, Record<string, RunwayMode>> = {
  VTCC: { '18': 'ARR', '36': 'CLOSED' }, VTSP: { '09': 'CLOSED', '27': 'ARR' },
  VTBD: vtbdModesForFlow({ '21R': 'ARR', '21L': 'ARR' }, '21'),
  VTBS: vtbsModesForFlow({ '19': 'MIX', '20L': 'DEP', '20R': 'ARR' }, '19_20'),
}

const DEFAULT_SPACING_NM: Record<string, number> = {
  'VTCC:18': 5, 'VTCC:36': 5, 'VTSP:09': 5, 'VTSP:27': 5,
  'VTBD:21R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21R'],
  'VTBD:21L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21L'],
  'VTBD:03L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['03L'],
  'VTBD:03R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['03R'],
  'VTBS:19': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['19'],
  'VTBS:20L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20L'],
  'VTBS:20R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20R'],
  'VTBS:01': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['01'],
  'VTBS:02L': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['02L'],
  'VTBS:02R': AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['02R'],
}

export function resetAirportSpacing(current: Record<string, number>, airport: AirportCode, vtbsFlow: VtbsFlow = '19_20', vtbdFlow: VtbdFlow = '21') {
  const next = { ...current }
  for (const runway of airport === 'VTBS' ? VTBS_RUNWAY_GROUPS[vtbsFlow] : airport === 'VTBD' ? VTBD_RUNWAY_GROUPS[vtbdFlow] : RUNWAYS[airport]) {
    next[spacingKey(airport, runway)] = DEFAULT_SPACING_NM[spacingKey(airport, runway)]
  }
  return next
}

const DEMO_SPECS: Record<AirportCode, readonly DemoSpec[]> = {
  // Synthetic queue exercises only; these are not operational timing profiles.
  VTCC: [
    { callsign: 'TESTCC1', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'ADLUS', naturalLandingOffsetMinutes: 18 },
    { callsign: 'TESTCC2', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'ADLUS', naturalLandingOffsetMinutes: 19 },
  ],
  VTSP: [
    { callsign: 'TESTSP1', aircraftType: 'A320', wakeTurbulence: 'M', refFix: 'ANPUB', naturalLandingOffsetMinutes: 20 },
    { callsign: 'TESTSP2', aircraftType: 'B738', wakeTurbulence: 'M', refFix: 'ANPUB', naturalLandingOffsetMinutes: 21 },
  ],
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
const AUTHORITATIVE_AUTO_RETURN_MAX_AGE_MS = 60_000
const UNKNOWN_DISTANCE_FALLBACK_MINUTES = 45
const VTBS_CROSS_RUNWAY_STAGGER_SECONDS = 60
const VTBD_21L_CALLSIGN_PREFIXES = ['LKY', 'RTN', 'WHK', 'RTAF', 'VMS'] as const
const routeGeometryCache = new Map<string, Promise<RouteGeometry | null>>()

function scopeAirports(scope: AirportScope): AirportCode[] {
  return scope === 'BOTH' ? ['VTBD', 'VTBS'] : scope.split(',').filter(isAmanAirport)
}

function spacingKey(airport: AirportCode, runway: string) {
  return `${airport}:${runway}`
}

function flightKey(airport: string, callsign: string) {
  return `${airport}:${callsign.trim().toUpperCase()}`
}

function rowAirport(id: string): AirportCode {
  return airportFromId(id)
}

function normalizedFlightState(flight: IvaoArrivalTrafficFlight) {
  return String(flight.state || '').trim().toLowerCase()
}

function airborneFlight(flight: IvaoArrivalTrafficFlight) {
  return flight.onGround === false || ['initial climb', 'en route', 'approach'].includes(normalizedFlightState(flight))
}

function confirmedTakeoff(flight: IvaoArrivalTrafficFlight) {
  return flight.actualDepartureTimeSeconds != null || Boolean(flight.trackedTakeoffAt)
}

function previewGroundPhase(item: InboundPreview) {
  if (airborneFlight(item.flight)) return confirmedTakeoff(item.flight) || item.flight.isDomesticThailand !== true
    ? 'AIRBORNE'
    : 'TAKEOFF_EST'
  if (normalizedFlightState(item.flight) === 'departing' || /ETA STAGE DEPARTING/i.test(item.reason || '')) return 'DEPARTING'
  return 'BOARDING'
}

export function mergeAirportRefresh<T>(
  current: T[],
  refreshed: T[],
  refreshedAirports: AirportCode[],
  airportOf: (item: T) => AirportCode,
) {
  const refreshedSet = new Set(refreshedAirports)
  return [...current.filter((item) => !refreshedSet.has(airportOf(item))), ...refreshed]
}

function predictionFlightKey(prediction: Pick<AmanArrivalPrediction, 'id' | 'callsign'>) {
  return flightKey(rowAirport(prediction.id), prediction.callsign)
}

function vtbdDefaultRunway(callsign: string) {
  const normalized = callsign.trim().toUpperCase()
  return VTBD_21L_CALLSIGN_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ? '21L' : '21R'
}

export function defaultArrivalRunway(airport: AirportCode, activeRunways: string[], callsign: string) {
  if (airport === 'VTBS' && activeRunways.includes('19')) return '19'
  if (airport === 'VTBS' && activeRunways.includes('01')) return '01'
  if (airport === 'VTBD') {
    const southPreferred = vtbdDefaultRunway(callsign)
    const north = activeRunways.some(r => VTBD_RUNWAY_GROUPS['03'].includes(r))
    const preferred = north ? (southPreferred === '21R' ? '03L' : '03R') : southPreferred
    if (activeRunways.includes(preferred)) return preferred
  }
  return activeRunways[0] ?? null
}

function formatUtc(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}Z`
}

function formatHm(value: string | null) {
  return formatRoundedHmUtc(value)
}

function formatHms(value: string | null) {
  if (!value) return '--:--:--'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--:--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}`
}

function formatDelay(minutes: number) {
  const rounded = Math.round(minutes * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}`
}

function formatSplit(minutes: number) {
  const rounded = Math.round(minutes * 10) / 10
  return rounded.toFixed(rounded % 1 === 0 ? 0 : 1)
}

export function nominalStarSeconds(airport: AirportCode, fix: string, vtbsFlow: VtbsFlow = '19_20', vtbdFlow: VtbdFlow = '21') {
  if (airport === 'VTBD') {
    const table = vtbdFlow === '03' ? VTBD_STAR03_NOMINAL_MINUTES : VTBD_IAWP_NOMINAL_MINUTES
    const minutes = (table as Record<string, number>)[fix]
    return Number.isFinite(minutes) ? minutes * 60 : null
  }
  const table = vtbsFlow === '01_02' ? VTBS_STAR01_NOMINAL_MINUTES : VTBS_STAR19_NOMINAL_MINUTES
  const minutes = (table as Record<string, number>)[fix]
  return Number.isFinite(minutes) ? minutes * 60 : null
}

export function masterTimingLookup(config: OperationalConfigPayload | null, vtbsFlow: VtbsFlow = '19_20', vtbdFlow: VtbdFlow = '21') {
  const result: Record<AirportCode, Record<string, number>> = { VTBD: {}, VTBS: {}, VTCC: {}, VTSP: {} }
  if (!config) return result
  for (const airport of ['VTBD', 'VTBS'] as const) {
    const airportWorkspaces = config.workspaces.filter((item) => item.airport === airport)
    const workspace = airportWorkspaces.find((item) => item.flow === (airport === 'VTBS' ? vtbsFlow : vtbdFlow))
    for (const timing of workspace?.timings ?? []) {
      if (Number.isFinite(timing.nominalSeconds) && timing.nominalSeconds > 0) {
        result[airport][timing.fix.toUpperCase()] = timing.nominalSeconds
      }
    }
  }
  return result
}

function hasOperationalWorkspace(config: OperationalConfigPayload | null, airport: AirportCode, vtbsFlow: VtbsFlow = '19_20', vtbdFlow: VtbdFlow = '21') {
  if (!config) return false
  const matches = config.workspaces.filter((item) => item.airport === airport)
  return matches.some((item) => item.flow === (airport === 'VTBS' ? vtbsFlow : airport === 'VTBD' ? vtbdFlow : RUNTIME_MASTER_FLOW[airport]))
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

function resolveRouteGeometry(flight: IvaoArrivalTrafficFlight, airport: AirportCode, entryFix: string) {
  const baseKey = routeKey(flight, airport)
  if (!baseKey || !flight.departure || !flight.route) return Promise.resolve<RouteGeometry | null>(null)
  const key = `${baseKey}|${entryFix}`
  const existing = routeGeometryCache.get(key)
  if (existing) return existing
  const request = readRouteGeometry<RouteGeometry>(flight.departure, airport, flight.route, undefined, { entryFix })
    .then((geometry) => {
      const usable = geometry.entryRoute || (geometry.errors.length ? null : geometry)
      if (!usable) routeGeometryCache.delete(key)
      return usable
    }).catch(() => { routeGeometryCache.delete(key); return null })
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

function processingDistanceNm(flight: IvaoArrivalTrafficFlight) {
  if (!Number.isFinite(flight.latitude) || !Number.isFinite(flight.longitude)) return null
  const reference = isRegionalAirport(flight.arrival) ? AIRPORT_REFERENCE[flight.arrival] : BKK_VOR_COORDINATES
  return distanceNm(reference.lat, reference.lon, Number(flight.latitude), Number(flight.longitude))
}

function buildDemoPredictions(airport: AirportCode, anchor: Date, timingLookup: Record<AirportCode, Record<string, number>>, useMaster: boolean, vtbsFlow: VtbsFlow = '19_20', vtbdFlow: VtbdFlow = '21') {
  return DEMO_SPECS[airport].flatMap<AmanArrivalPrediction>((spec, index) => {
    const nominalSeconds = isRegionalAirport(airport) ? 15 * 60 : useMaster
      ? timingLookup[airport][spec.refFix] ?? null
      : nominalStarSeconds(airport, spec.refFix, vtbsFlow, vtbdFlow)
    if (nominalSeconds == null) return []
    const naturalLandingMs = anchor.getTime() + spec.naturalLandingOffsetMinutes * 60_000
    return [{
      id: `demo:${airport}:${index}`,
      callsign: spec.callsign,
      aircraftType: spec.aircraftType,
      wakeTurbulence: spec.wakeTurbulence,
      runway: '',
      refFix: spec.refFix,
      predictedIawpAt: new Date(naturalLandingMs - nominalSeconds * 1000).toISOString(),
      nominalStarSeconds: nominalSeconds,
      processingDistanceNm: 70 + index * 12,
    }]
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

function isWithinProcessingRadius(prediction: AmanArrivalPrediction, nowMs: number) {
  if (Number.isFinite(prediction.processingDistanceNm)) {
    return Number(prediction.processingDistanceNm) <= AMAN_PROCESSING_RADIUS_NM
  }
  const iAwpMs = new Date(prediction.predictedIawpAt).getTime()
  return Number.isFinite(iAwpMs) && iAwpMs - nowMs <= UNKNOWN_DISTANCE_FALLBACK_MINUTES * 60_000
}

function isAtrType(value: string | null) {
  const type = String(value || '').trim().toUpperCase()
  return type.startsWith('AT7') || type.startsWith('ATR')
}

function followerLandingSeparationSeconds(
  follower: AmanArrivalPrediction,
  runwayBaseSeconds: number,
) {
  let required = Math.max(0, runwayBaseSeconds)
  const followerType = String(follower.aircraftType || '').trim().toUpperCase()
  const followerWake = String(follower.wakeTurbulence || '').trim().toUpperCase()

  if (followerWake === 'J' || followerType === 'A388' || followerType === 'A380') {
    required = Math.max(required, AMAN_SPECIAL_SEPARATION_MINUTES.A380 * 60)
  }
  if (isAtrType(follower.aircraftType)) {
    required = Math.max(required, AMAN_SPECIAL_SEPARATION_MINUTES.ATR * 60)
  }
  return required
}

function pairwiseLandingSeparationSeconds(
  leader: AmanArrivalPrediction,
  follower: AmanArrivalPrediction,
  runwayBaseSeconds: number,
) {
  const landingSeparation = followerLandingSeparationSeconds(follower, runwayBaseSeconds)
  return resolveAmanPairwiseSeparationSeconds(leader, follower, landingSeparation)
}

function crossRunwayLandingSeparationSeconds(
  airport: AirportCode,
  leader: AmanArrivalPrediction,
  follower: AmanArrivalPrediction,
  runwaySpacingSeconds: Record<string, number>,
) {
  const baseSeconds = airport === 'VTBD'
    ? Math.max(0, runwaySpacingSeconds[follower.runway] ?? 0)
    : VTBS_CROSS_RUNWAY_STAGGER_SECONDS
  return pairwiseLandingSeparationSeconds(leader, follower, baseSeconds)
}

function assignPredictionsToRunways(
  predictions: AmanArrivalPrediction[],
  airport: AirportCode,
  runwayModes: Record<AirportCode, Record<string, RunwayMode>>,
  manualRunways: Record<string, string>,
) {
  const activeRunways = activeRunwaysForAirport(airport, runwayModes)
  if (!activeRunways.length) return []

  const ordered = [...predictions].sort((a, b) => naturalLandingTimeMs(a) - naturalLandingTimeMs(b) || a.callsign.localeCompare(b.callsign))

  return ordered.map((prediction) => {
    const requestedRunway = manualRunways[prediction.id]
    const forcedRunway = requestedRunway && activeRunways.includes(requestedRunway) ? requestedRunway : null
    return { ...prediction, runway: forcedRunway ?? defaultArrivalRunway(airport, activeRunways, prediction.callsign) ?? activeRunways[0] }
  })
}

export function isWithinProvisionalPlanningWindow(prediction: AmanArrivalPrediction, nowMs: number) {
  const landingMs = naturalLandingTimeMs(prediction)
  return Number.isFinite(landingMs)
    && landingMs <= nowMs + TIMELINE_FUTURE_HORIZON_MINUTES * 60_000
}

export function applyManualTargetsWithCascade(
  rows: AmanSequenceRow[],
  manualTldt: Record<string, string>,
  runwaySpacingSeconds: Record<string, number>,
  gapAfterSeconds: Record<string, number>,
  autoReturnFloorTldt: Record<string, string> = {},
  authoritativeAutoTldt: Record<string, string> = {},
) {
  const targetById = new Map<string, number>()
  const controllerAffectedIds = new Set<string>()
  rows.forEach((row) => {
    const manualTarget = manualTldt[row.id]
    if (manualTarget) controllerAffectedIds.add(row.id)
    const baseTargetMs = new Date(manualTarget ?? authoritativeAutoTldt[row.id] ?? row.tldt).getTime()
    const autoFloorMs = manualTarget ? NaN : new Date(autoReturnFloorTldt[row.id] ?? '').getTime()
    targetById.set(row.id, Number.isFinite(autoFloorMs) ? Math.max(baseTargetMs, autoFloorMs) : baseTargetMs)
  })

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
            + Math.max(0, gapAfterSeconds[previousRow.id] ?? 0)
          const earliest = previousTargetMs + requiredSeconds * 1000
          if (targetMs < earliest) {
            targetMs = earliest
            targetById.set(row.id, targetMs)
            if (controllerAffectedIds.has(previousRow.id) || (gapAfterSeconds[previousRow.id] ?? 0) > 0) {
              controllerAffectedIds.add(row.id)
            }
            changed = true
          }
        }
        previousTargetMs = targetMs
        previousRow = row
      }
    }

    for (const airport of ['VTBD', 'VTBS'] as const) {
      const airportRows = rows
        .filter((row) => rowAirport(row.id) === airport)
        .sort((a, b) => airport === 'VTBD'
          ? a.sequenceIndex - b.sequenceIndex
          : (targetById.get(a.id) ?? 0) - (targetById.get(b.id) ?? 0) || a.sequenceIndex - b.sequenceIndex)

      for (let index = 1; index < airportRows.length; index += 1) {
        const leader = airportRows[index - 1]
        const follower = airportRows[index]
        if (leader.runway === follower.runway) continue
        const leaderTarget = targetById.get(leader.id) ?? new Date(leader.tldt).getTime()
        const followerTarget = targetById.get(follower.id) ?? new Date(follower.tldt).getTime()
        const requiredSeconds = crossRunwayLandingSeparationSeconds(airport, leader, follower, runwaySpacingSeconds)
          + Math.max(0, gapAfterSeconds[leader.id] ?? 0)
        const earliest = leaderTarget + requiredSeconds * 1000
        if (followerTarget < earliest) {
          targetById.set(follower.id, earliest)
          if (controllerAffectedIds.has(leader.id) || (gapAfterSeconds[leader.id] ?? 0) > 0) {
            controllerAffectedIds.add(follower.id)
          }
          changed = true
        }
      }
    }

    if (!changed) break
  }

  return rows
    .map((row) => {
      const targetMs = targetById.get(row.id) ?? new Date(row.tldt).getTime()
      const targetIso = new Date(targetMs).toISOString()
      const controllerAffected = controllerAffectedIds.has(row.id)
      if (!controllerAffected) clearArrivalControllerDelayBaseline(row.id)
      const metrics = calculateArrivalMetrics(row, targetIso, controllerAffected ? undefined : targetIso)
      return {
        ...metrics,
        sequenceIndex: row.sequenceIndex,
        autoShiftSeconds: Math.max(0, Math.round((targetMs - new Date(metrics.naturalLandingAt).getTime()) / 1000)),
      } satisfies AmanSequenceRow
    })
    // Timeline chronology controls render order only. Keep sequenceIndex as the
    // explicit operational rank used by same-runway cascade; a pure TLDT move may
    // cross another timestamp without silently becoming a sequence reorder.
    .sort((a, b) => new Date(a.tldt).getTime() - new Date(b.tldt).getTime() || a.callsign.localeCompare(b.callsign))
}

export function currentSharedAutoReturnOverrides(
  predictions: Array<Pick<AmanArrivalPrediction, 'id' | 'callsign'>>,
  states: SharedOperationalFlight[],
  nowMs = Date.now(),
  vtbsFlow?: VtbsFlow,
  vtbdFlow?: VtbdFlow,
) {
  const byFlight = new Map(states.map((state) => [flightKey(state.airport, state.callsign), state]))
  const tldtById: Record<string, string> = {}
  const floorById: Record<string, string> = {}
  const runwayById: Record<string, string> = {}

  for (const prediction of predictions) {
    const state = byFlight.get(predictionFlightKey(prediction))
    if (!state) continue
    const flowAllows = (runway: string) => state.airport === 'VTBS' && vtbsFlow ? VTBS_RUNWAY_GROUPS[vtbsFlow].includes(runway)
      : state.airport === 'VTBD' && vtbdFlow ? VTBD_RUNWAY_GROUPS[vtbdFlow].includes(runway) : true
    // An opposite-flow manual target is ignored without mutating its DB record.
    // A fresh Frozen capture on the selected 03/21 runway must still take effect.
    const oppositeBdManual = state.airport === 'VTBD' && vtbdFlow && state.target_mode === 'MANUAL'
      && state.manual_runway && !flowAllows(state.manual_runway.toUpperCase())
    if (state.target_mode !== 'AUTO' && !oppositeBdManual) continue
    const frozenTargetMs = new Date(state.frozen_tldt || '').getTime()
    const frozenRunway = String(state.frozen_runway || '').trim().toUpperCase()
    if (Number.isFinite(frozenTargetMs) && flowAllows(frozenRunway)) {
      tldtById[prediction.id] = new Date(frozenTargetMs).toISOString()
      if (frozenRunway) runwayById[prediction.id] = frozenRunway
      continue
    }
    const targetMs = new Date(state.auto_return_tldt || '').getTime()
    const floorMs = new Date(state.auto_return_floor_tldt || '').getTime()
    const returnedAtMs = new Date(state.auto_returned_at || '').getTime()
    const runway = String(state.auto_return_runway || '').trim().toUpperCase()
    if (!flowAllows(runway)) continue
    const ageMs = nowMs - returnedAtMs
    if (Number.isFinite(floorMs)) floorById[prediction.id] = new Date(floorMs).toISOString()
    if (!Number.isFinite(targetMs) || !Number.isFinite(returnedAtMs) || !runway) continue
    if (ageMs < -10_000 || ageMs > AUTHORITATIVE_AUTO_RETURN_MAX_AGE_MS) continue
    tldtById[prediction.id] = new Date(targetMs).toISOString()
    runwayById[prediction.id] = runway
  }

  return { tldtById, floorById, runwayById }
}

export function configuredAirportCapacityPerHour(
  airport: AirportCode,
  runwayModes: Record<AirportCode, Record<string, RunwayMode>>,
  spacingNm: Record<string, number>,
) {
  const configured = activeRunwaysForAirport(airport, runwayModes).reduce((sum, runway) => {
    const spacingMinutes = nmToMinutesAtReferenceSpeed(spacingNm[spacingKey(airport, runway)] ?? 5)
    const rate = spacingMinutes > 0 ? 60 / spacingMinutes : 0
    return airport === 'VTBD' ? Math.max(sum, rate) : sum + rate
  }, 0)
  const rounded = Math.max(0, Math.floor(configured))
  if (airport === 'VTBS') return Math.min(rounded, AMAN_REFERENCE_AAR_PER_HOUR.VTBS)
  return rounded
}

async function postOperationalAction(body: Record<string, unknown>) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ serviceDate: new Date().toISOString().slice(0, 10), ...body }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Operational AMAN API returned ${response.status}`)
}

export default function App() {
  const user = useAuthUser()
  const [now, setNow] = useState(() => new Date())
  const [airportView, setAirportView] = useState<AirportView>({ ...DEFAULT_AIRPORT_VIEW })
  const airportScope = Object.values(airportView).filter(Boolean).join(',')
  const [regionalNav, setRegionalNav] = useState<Partial<Record<AirportCode, RegionalNavPayload>>>({})
  const [approachByAirport, setApproachByAirport] = useState<Record<string, string>>({
    'VTCC:18': 'R18', 'VTCC:36': 'I36-Z', 'VTSP:09': 'R09-Y', 'VTSP:27': 'I27',
  })
  const [runwayModes, setRunwayModes] = useState<Record<AirportCode, Record<string, RunwayMode>>>(() => Object.fromEntries(AMAN_AIRPORTS.map(code => [code, { ...DEFAULT_RUNWAY_MODES[code] }])) as Record<AirportCode, Record<string, RunwayMode>>)
  const [profileByAirport, setProfileByAirport] = useState<Record<AirportCode, string>>({ ...DEFAULT_PROFILE })
  const [vtbsFlow, setVtbsFlow] = useState<VtbsFlow>('19_20')
  const [vtbdFlow, setVtbdFlow] = useState<VtbdFlow>('21')
  const [spacingNm, setSpacingNm] = useState<Record<string, number>>({ ...DEFAULT_SPACING_NM })
  const [historyMinutes, setHistoryMinutes] = useState(AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES)
  const [inbound, setInbound] = useState<InboundPreview[]>([])
  const [livePredictions, setLivePredictions] = useState<AmanArrivalPrediction[]>([])
  const [canonicalEtaById, setCanonicalEtaById] = useState<Record<string, Pick<AmanArrivalPrediction, 'predictedIawpAt' | 'regional'>>>({})
  const [loading, setLoading] = useState(true)
  const [trafficErrorsByAirport, setTrafficErrorsByAirport] = useState<Partial<Record<AirportCode, string>>>({})
  const [operationalConfig, setOperationalConfig] = useState<OperationalConfigPayload | null>(null)
  const [operationalConfigError, setOperationalConfigError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [demoAnchors, setDemoAnchors] = useState<Record<AirportCode, Date> | null>(null)
  const [manualTldt, setManualTldt] = useState<Record<string, string>>({})
  const [manualRunways, setManualRunways] = useState<Record<string, string>>({})
  const [stableIds, setStableIds] = useState<Record<string, true>>({})
  const [autoReturnFloorTldt, setAutoReturnFloorTldt] = useState<Record<string, string>>({})
  const [operationalStateByKey, setOperationalStateByKey] = useState<Record<string, OperationalState>>({})
  const [reservedGapSecondsByKey, setReservedGapSecondsByKey] = useState<Record<string, number>>({})
  const [sharedOperationalFlights, setSharedOperationalFlights] = useState<SharedOperationalFlight[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [opsMenu, setOpsMenu] = useState<OpsMenuState | null>(null)
  const [mobileInboundOpen, setMobileInboundOpen] = useState(false)
  const [mobileInboundUnread, setMobileInboundUnread] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const manualTldtRef = useRef(manualTldt)
  manualTldtRef.current = manualTldt
  const latestPredictionState = useRef({ livePredictions, canonicalEtaById })
  latestPredictionState.current = { livePredictions, canonicalEtaById }
  const previousInboundRef = useRef<{ scope: AirportScope; ids: Set<string> } | null>(null)

  const airports = useMemo(() => scopeAirports(airportScope), [airportScope])
  const trafficError = airports
    .map((airport) => trafficErrorsByAirport[airport] ? `${airport}: ${trafficErrorsByAirport[airport]}` : null)
    .filter((value): value is string => Boolean(value))
    .join(' · ') || null
  const operationalTimings = useMemo(() => masterTimingLookup(operationalConfig, vtbsFlow, vtbdFlow), [operationalConfig, vtbsFlow, vtbdFlow])
  const operationalTimingCount = Object.values(operationalTimings).reduce((total, timings) => total + Object.keys(timings).length, 0)
  const ticks = useMemo(() => timelineTicks(now), [now])
  const processingNowMs = Math.floor(now.getTime() / 60_000) * 60_000
  const runwaySpacingSeconds = useMemo(() => {
    const result: Record<string, number> = {}
    for (const airport of AMAN_AIRPORTS) {
      for (const runway of RUNWAYS[airport]) {
        result[runway] = nmToMinutesAtReferenceSpeed(spacingNm[spacingKey(airport, runway)] ?? 5) * 60
      }
    }
    return result
  }, [spacingNm])

  useEffect(() => {
    const onCanonicalSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<{
        airport?: string
        arrivals?: Array<{ id?: string; predictedIawpAt?: string; regional?: AmanArrivalPrediction['regional'] }>
      }>).detail
      const airport = String(detail?.airport || '').trim().toUpperCase()
      const arrivals = detail?.arrivals
      if (!airport || !Array.isArray(arrivals)) return
      setCanonicalEtaById((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([id]) => !id.startsWith(`${airport}:`)))
        for (const item of arrivals) {
          const id = String(item.id || '')
          const eta = String(item.predictedIawpAt || '')
          if (id.startsWith(`${airport}:`) && Number.isFinite(new Date(eta).getTime())) next[id] = { predictedIawpAt: eta, regional: item.regional }
        }
        return next
      })
    }
    window.addEventListener('aman:canonical-auto-snapshot', onCanonicalSnapshot)
    return () => window.removeEventListener('aman:canonical-auto-snapshot', onCanonicalSnapshot)
  }, [])

  const livePhaseById = useMemo(
    () => new Map(inbound.map((item) => [item.id, isRegionalAirport(item.airport) && item.flight.onGround === false ? 'AIRBORNE' : previewGroundPhase(item)])),
    [inbound],
  )

  useEffect(() => {
    const publish = () => window.dispatchEvent(new CustomEvent('aman:local-auto-snapshot', {
      detail: {
        predictions: livePredictions
          .filter((prediction) => livePhaseById.get(prediction.id) === 'AIRBORNE')
          .map(({ id, predictedIawpAt, regional }) => ({ id, predictedIawpAt, regional })),
      },
    }))
    publish()
    window.addEventListener('aman:realtime-health', publish)
    return () => window.removeEventListener('aman:realtime-health', publish)
  }, [livePhaseById, livePredictions])

  const effectiveLivePredictions = useMemo(() => livePredictions.filter(prediction => {
    const airport = rowAirport(prediction.id)
    if (!isRegionalAirport(airport) && (hasOperationalWorkspace(operationalConfig, airport, vtbsFlow, vtbdFlow)
      ? operationalTimings[airport][prediction.refFix] == null
      : nominalStarSeconds(airport, prediction.refFix, vtbsFlow, vtbdFlow) == null)) return false
    if (!prediction.regional) return true
    const runway = prediction.regional.runway
    const approach = regionalNav[airport]?.airport.procedures.find(p => p.kind === 'APPROACH'
      && p.runway === runway && p.name === approachByAirport[`${airport}:${runway}`])
    return activeRunwaysForAirport(airport, runwayModes).includes(runway)
      && approach?.id === prediction.regional.modelKey.split('|')[3]
  }).map((prediction) => {
    const airport = rowAirport(prediction.id)
    if (!isRegionalAirport(airport)) {
      const nominal = hasOperationalWorkspace(operationalConfig, airport, vtbsFlow, vtbdFlow)
        ? operationalTimings[airport][prediction.refFix] : nominalStarSeconds(airport, prediction.refFix, vtbsFlow, vtbdFlow)
      if (nominal != null) prediction = { ...prediction, nominalStarSeconds: nominal }
    }
    const canonical = canonicalEtaById[prediction.id]
    if (!canonical || (prediction.regional && canonical.regional?.modelKey !== prediction.regional.modelKey)) return prediction
    return { ...prediction, predictedIawpAt: canonical.predictedIawpAt,
      ...(canonical.regional ? { regional: canonical.regional, nominalStarSeconds: canonical.regional.nominalStarSeconds } : {}) }
  }), [canonicalEtaById, livePredictions, regionalNav, runwayModes, approachByAirport, operationalConfig, operationalTimings, vtbsFlow, vtbdFlow])

  const sharedAutoReturnOverrides = useMemo(
    () => currentSharedAutoReturnOverrides(effectiveLivePredictions, sharedOperationalFlights, now.getTime(), vtbsFlow, vtbdFlow),
    [effectiveLivePredictions, now, sharedOperationalFlights, vtbsFlow, vtbdFlow],
  )
  const sharedOperationalFlightByKey = useMemo(
    () => new Map(sharedOperationalFlights.map((state) => [flightKey(state.airport, state.callsign), state])),
    [sharedOperationalFlights],
  )
  const effectiveLiveRunways = useMemo(
    () => ({ ...sharedAutoReturnOverrides.runwayById, ...manualRunways }),
    [manualRunways, sharedAutoReturnOverrides.runwayById],
  )
  const effectiveAutoReturnFloorTldt = useMemo(
    () => ({ ...autoReturnFloorTldt, ...sharedAutoReturnOverrides.floorById }),
    [autoReturnFloorTldt, sharedAutoReturnOverrides.floorById],
  )

  useEffect(() => {
    const onSharedState = (event: Event) => {
      const detail = (event as CustomEvent<SharedStateDetail>).detail
      if (!detail?.flightStates) return
      setSharedOperationalFlights(detail.flightStates)
      const nextStates: Record<string, OperationalState> = {}
      const nextGaps: Record<string, number> = {}
      for (const state of detail.flightStates) {
        const key = flightKey(state.airport, state.callsign)
        const operationalState = state.operational_state || 'NORMAL'
        nextStates[key] = operationalState
        const gap = Number(state.reserved_gap_seconds)
        if (Number.isFinite(gap) && gap > 0) nextGaps[key] = gap
      }
      setOperationalStateByKey(nextStates)
      setReservedGapSecondsByKey(nextGaps)
    }
    window.addEventListener('aman:shared-state', onSharedState)
    return () => window.removeEventListener('aman:shared-state', onSharedState)
  }, [])

  useEffect(() => {
    if (!opsMenu) return
    const close = () => setOpsMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [opsMenu])

  const activeArrivalRunways = useMemo(() => airports.flatMap((airport) =>
    activeRunwaysForAirport(airport, runwayModes).map((runway) => ({ airport, runway })),
  ), [airports, runwayModes])

  const liveSequencedPredictions = useMemo(() => effectiveLivePredictions.filter((prediction) => {
    const state = operationalStateByKey[predictionFlightKey(prediction)] ?? 'NORMAL'
    return state === 'NORMAL'
      && livePhaseById.get(prediction.id) === 'AIRBORNE'
      && isWithinProcessingRadius(prediction, processingNowMs)
  }), [effectiveLivePredictions, livePhaseById, operationalStateByKey, processingNowMs])

  const gapAfterSecondsById = useMemo(() => {
    const result: Record<string, number> = {}
    for (const prediction of effectiveLivePredictions) {
      const seconds = reservedGapSecondsByKey[predictionFlightKey(prediction)]
      if (Number.isFinite(seconds) && seconds > 0) result[prediction.id] = seconds
    }
    return result
  }, [effectiveLivePredictions, reservedGapSecondsByKey])

  const liveBaseSequence = useMemo(() => {
    const assigned = airports.flatMap((airport) => assignPredictionsToRunways(
      liveSequencedPredictions.filter((prediction) => rowAirport(prediction.id) === airport),
      airport,
      runwayModes,
      effectiveLiveRunways,
    ))
    return autoSequenceUnstableArrivals(assigned, {
      runwaySpacingSeconds,
      pairwiseSeparationSeconds: pairwiseLandingSeparationSeconds,
    })
  }, [airports, effectiveLiveRunways, liveSequencedPredictions, runwayModes, runwaySpacingSeconds])

  const provisionalSequence = useMemo(() => {
    if (demoMode) return []
    const provisional = effectiveLivePredictions.filter((prediction) => {
      const phase = livePhaseById.get(prediction.id)
      const state = operationalStateByKey[predictionFlightKey(prediction)] ?? 'NORMAL'
      return state === 'NORMAL'
        && (phase === 'DEPARTING' || phase === 'TAKEOFF_EST')
        // A ground departure can be thousands of miles from Bangkok by design.
        // Keep it as provisional planning context when its projected landing is
        // inside the visible timeline; the 300 NM gate remains exclusive to the
        // active operational sequence below.
        && isWithinProvisionalPlanningWindow(prediction, processingNowMs)
    })
    const assigned = airports.flatMap((airport) => assignPredictionsToRunways(
      provisional.filter((prediction) => rowAirport(prediction.id) === airport),
      airport,
      runwayModes,
      effectiveLiveRunways,
    ))
    return assigned
      .map((prediction) => {
        const naturalTldt = new Date(new Date(prediction.predictedIawpAt).getTime() + prediction.nominalStarSeconds * 1000).toISOString()
        return { ...calculateArrivalMetrics(prediction, naturalTldt, naturalTldt), sequenceIndex: -1, autoShiftSeconds: 0 }
      })
      .sort((a, b) => new Date(a.tldt).getTime() - new Date(b.tldt).getTime())
  }, [airports, demoMode, effectiveLivePredictions, effectiveLiveRunways, livePhaseById, operationalStateByKey, processingNowMs, runwayModes])

  const demoBaseSequence = useMemo(() => {
    if (!demoMode || !demoAnchors) return []
    const assigned = airports.flatMap((airport) => assignPredictionsToRunways(
      buildDemoPredictions(airport, demoAnchors[airport], operationalTimings, hasOperationalWorkspace(operationalConfig, airport, vtbsFlow, vtbdFlow), vtbsFlow, vtbdFlow),
      airport,
      runwayModes,
      manualRunways,
    ))
    return autoSequenceUnstableArrivals(assigned, {
      runwaySpacingSeconds,
      pairwiseSeparationSeconds: pairwiseLandingSeparationSeconds,
    })
  }, [airports, demoAnchors, demoMode, manualRunways, operationalConfig, operationalTimings, runwayModes, runwaySpacingSeconds, vtbsFlow, vtbdFlow])

  const demoSequence = useMemo(
    () => applyManualTargetsWithCascade(demoBaseSequence, manualTldt, runwaySpacingSeconds, {}, autoReturnFloorTldt),
    [autoReturnFloorTldt, demoBaseSequence, manualTldt, runwaySpacingSeconds],
  )
  const liveSequence = useMemo(
    () => applyManualTargetsWithCascade(
      liveBaseSequence,
      manualTldt,
      runwaySpacingSeconds,
      gapAfterSecondsById,
      effectiveAutoReturnFloorTldt,
      sharedAutoReturnOverrides.tldtById,
    ),
    [effectiveAutoReturnFloorTldt, gapAfterSecondsById, liveBaseSequence, manualTldt, runwaySpacingSeconds, sharedAutoReturnOverrides.tldtById],
  )
  const activeSequence = demoMode ? demoSequence : liveSequence
  const liveRouteCount = useMemo(() => inbound.filter((item) => item.source === 'LIVE_ROUTE' || (item.source === 'REGIONAL EST' && !item.reason)).length, [inbound])
  const liveTmaCount = useMemo(() => inbound.filter(({ flight }) => {
    const distance = processingDistanceNm(flight)
    return distance != null && distance <= BANGKOK_TMA_WORKING_RADIUS_NM
  }).length, [inbound])
  const averageDelay = useMemo(() => averageDelayMinutes(activeSequence), [activeSequence])
  const visibleSequence = useMemo(() => {
    const cutoff = now.getTime() - historyMinutes * 60_000
    return activeSequence.filter((row) => new Date(row.tldt).getTime() >= cutoff)
  }, [activeSequence, historyMinutes, now])
  const visibleProvisionalSequence = useMemo(() => {
    const cutoff = now.getTime() - historyMinutes * 60_000
    return provisionalSequence.filter((row) => new Date(row.tldt).getTime() >= cutoff)
  }, [historyMinutes, now, provisionalSequence])

  const capacityByAirport = useMemo(() => Object.fromEntries(airports.map((airport) => [
    airport,
    configuredAirportCapacityPerHour(airport, runwayModes, spacingNm),
  ])) as Record<AirportCode, number>, [airports, runwayModes, spacingNm])

  const demandByAirport = useMemo(() => {
    const result: Record<AirportCode, number> = { VTBD: 0, VTBS: 0, VTCC: 0, VTSP: 0 }
    const start = now.getTime()
    const end = start + 60 * 60_000
    for (const row of activeSequence) {
      const target = new Date(row.tldt).getTime()
      if (target >= start && target < end) result[rowAirport(row.id)] += 1
    }
    return result
  }, [activeSequence, now])

  const capacityOverload = airports.some((airport) => demandByAirport[airport] > capacityByAirport[airport] && capacityByAirport[airport] > 0)
  const matrixOverloadCount = activeSequence.filter((row) => getAmanOperationalMatrixAdvice(row.delayMinutes).band === 'OVERLOAD').length
  const activeGaCount = activeSequence.filter((row) => {
    const airport = rowAirport(row.id)
    return sharedOperationalFlightByKey.get(flightKey(airport, row.callsign))?.missed_approach_active === true
  }).length
  const capacitySummary = airports.map((airport) => `${airport.slice(2)} ${demandByAirport[airport]}/${capacityByAirport[airport] || '--'}`).join(' · ')

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
          + Math.max(0, gapAfterSecondsById[previous.id] ?? 0)
        if (gapMs + 500 < requiredSeconds * 1000) {
          conflicts.add(previous.id)
          conflicts.add(row.id)
        }
      }
      previousByAirportRunway.set(key, row)
    }

    for (const airport of ['VTBD', 'VTBS'] as const) {
      const airportRows = ordered
        .filter((row) => rowAirport(row.id) === airport)
        .sort((a, b) => airport === 'VTBD' ? a.sequenceIndex - b.sequenceIndex : 0)
      for (let index = 1; index < airportRows.length; index += 1) {
        const leader = airportRows[index - 1]
        const follower = airportRows[index]
        if (leader.runway === follower.runway) continue
        const gapMs = new Date(follower.tldt).getTime() - new Date(leader.tldt).getTime()
        const requiredSeconds = crossRunwayLandingSeparationSeconds(airport, leader, follower, runwaySpacingSeconds)
          + Math.max(0, gapAfterSecondsById[leader.id] ?? 0)
        if (gapMs + 500 < requiredSeconds * 1000) {
          conflicts.add(leader.id)
          conflicts.add(follower.id)
        }
      }
    }

    return conflicts
  }, [activeSequence, gapAfterSecondsById, runwaySpacingSeconds])

  const livePredictionById = useMemo(() => new Map(effectiveLivePredictions.map((prediction) => [prediction.id, prediction])), [effectiveLivePredictions])
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
        processingDistanceNm: row.processingDistanceNm ?? null,
        operationalState: 'NORMAL',
      }))
    : inbound.map((item) => {
        const prediction = livePredictionById.get(item.id)
        const operationalState = operationalStateByKey[flightKey(item.airport, item.flight.callsign)] ?? 'NORMAL'
        let planningState: PlanningState
        if (operationalState === 'MISSED_APPROACH') planningState = 'MISSED'
        else if (operationalState === 'DESEQUENCED') planningState = 'DESEQUENCED'
        else if (operationalState === 'REMOVED') planningState = 'REMOVED'
        else if (livePhaseById.get(item.id) === 'BOARDING') planningState = 'BOARDING'
        else if (livePhaseById.get(item.id) === 'DEPARTING') planningState = 'DEPARTING'
        else if (livePhaseById.get(item.id) === 'TAKEOFF_EST') planningState = 'TAKEOFF_EST'
        else if (prediction && isWithinProcessingRadius(prediction, processingNowMs)) planningState = 'SEQUENCED'
        else planningState = 'MONITORED'

        const distanceText = Number.isFinite(item.processingDistanceNm) ? ` · ${Math.round(Number(item.processingDistanceNm))} NM BKK` : ''
        return {
          id: item.id,
          airport: item.airport,
          callsign: item.flight.callsign,
          aircraft: item.flight.aircraft || '----',
          refFix: item.refFix || '----',
          eta: item.predictedIawpAt,
          title: `${item.source}${stableIds[item.id] ? ' · ATC MANUAL / STABLE' : ''}${planningState === 'BOARDING' ? ' · BOARDING / NOT YET IN SEQUENCE' : ''}${planningState === 'DEPARTING' ? ' · DEPARTING / PROVISIONAL ETA ONLY' : ''}${planningState === 'TAKEOFF_EST' ? ' · AIRBORNE / ACTUAL TAKEOFF PENDING' : ''}${planningState === 'MONITORED' ? ` · MONITORED OUTSIDE ${AMAN_PROCESSING_RADIUS_NM} NM PROCESSING RADIUS` : ''}${planningState === 'MISSED' ? ' · MISSED APPROACH / AWAITING REINSERT' : ''}${planningState === 'DESEQUENCED' ? ' · DESEQUENCED / AWAITING REINSERT' : ''}${planningState === 'REMOVED' ? ' · REMOVED FROM SEQUENCE' : ''}${distanceText}${item.reason ? ` · ${item.reason}` : ''}`,
          planningState,
          processingDistanceNm: item.processingDistanceNm,
          operationalState,
        }
      }),
  [demoMode, demoSequence, inbound, livePhaseById, livePredictionById, operationalStateByKey, processingNowMs, stableIds])

  useEffect(() => {
    const ids = new Set(displayInboundRows.map((item) => item.id))
    const previous = previousInboundRef.current
    if (previous?.scope === airportScope && !mobileInboundOpen) {
      const hasNewInbound = [...ids].some((id) => !previous.ids.has(id))
      if (hasNewInbound) setMobileInboundUnread(true)
    }
    if (mobileInboundOpen) setMobileInboundUnread(false)
    previousInboundRef.current = { scope: airportScope, ids }
  }, [airportScope, displayInboundRows, mobileInboundOpen])

  const toggleMobileInbound = () => {
    setMobileInboundOpen((open) => {
      if (!open) setMobileInboundUnread(false)
      return !open
    })
  }

  useEffect(() => {
    if (!mobileInboundOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileInboundOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileInboundOpen])

  const monitoredInboundCount = displayInboundRows.filter((item) => item.planningState === 'MONITORED').length
  const operationalQueueCount = displayInboundRows.filter((item) => ['MISSED', 'DESEQUENCED', 'REMOVED'].includes(item.planningState)).length
  const displayTmaCount = demoMode ? Math.min(8, demoSequence.length) : liveTmaCount
  const displayTotCount = demoMode ? demoSequence.length : inbound.length

  const resetManualState = () => {
    setManualTldt({})
    setManualRunways({})
    setStableIds({})
    setAutoReturnFloorTldt({})
    setDraggingId(null)
    dragRef.current = null
  }

  // A configuration change at BS must not erase a controller's BD/CC/SP edits.
  const resetAirportManualState = (airport: AirportCode) => {
    const omit = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values)
      .filter(([id]) => rowAirport(id) !== airport)) as Record<string, T>
    setManualTldt(omit)
    setManualRunways(omit)
    setStableIds(omit)
    setAutoReturnFloorTldt(omit)
    if (dragRef.current && rowAirport(dragRef.current.id) === airport) {
      dragRef.current = null
      setDraggingId(null)
    }
  }

  useEffect(() => {
    const apply = (event: Event) => {
      const state = (event as CustomEvent<{ profile_id: string; runway_modes: Record<string, string>; spacing_nm: Record<string, number>; settings?: Record<string, unknown> }>).detail
      if (!state?.runway_modes) return
      const flow = vtbsFlowFromWorkspace(state.runway_modes, state.settings)
      const modes = vtbsModesForFlow(state.runway_modes, flow)
      setVtbsFlow(flow)
      setRunwayModes(current => ({ ...current, VTBS: modes }))
      const profile = RUNWAY_PROFILES.VTBS.find(p => p.id === state.profile_id
        && VTBS_RUNWAY_GROUPS[flow].every(r => p.modes[r] === modes[r]))
      setProfileByAirport(current => ({ ...current, VTBS: profile?.id || 'CUSTOM' }))
      setSpacingNm(current => ({ ...current, ...Object.fromEntries(Object.entries(state.spacing_nm || {})
        .filter(([r, value]) => VTBS_ALL_RUNWAYS.includes(r) && Number.isFinite(value) && value > 0)
        .map(([r, value]) => [`VTBS:${r}`, value])) }))
    }
    window.addEventListener('aman:apply-vtbs-workspace', apply)
    return () => window.removeEventListener('aman:apply-vtbs-workspace', apply)
  }, [])

  useEffect(() => {
    const apply = (event: Event) => {
      const state = (event as CustomEvent<{ profile_id: string; runway_modes: Record<string, string>; spacing_nm: Record<string, number>; settings?: Record<string, unknown> }>).detail
      if (!state?.runway_modes) return
      const flow = vtbdFlowFromWorkspace(state.runway_modes, state.settings)
      const modes = vtbdModesForFlow(state.runway_modes, flow)
      setVtbdFlow(flow)
      setRunwayModes(current => ({ ...current, VTBD: modes }))
      const profile = RUNWAY_PROFILES.VTBD.find(p => p.id === state.profile_id
        && VTBD_RUNWAY_GROUPS[flow].every(r => p.modes[r] === modes[r]))
      setProfileByAirport(current => ({ ...current, VTBD: profile?.id || 'CUSTOM' }))
      setSpacingNm(current => ({ ...current, ...Object.fromEntries(Object.entries(state.spacing_nm || {})
        .filter(([r, value]) => VTBD_ALL_RUNWAYS.includes(r) && Number.isFinite(value) && value > 0)
        .map(([r, value]) => [`VTBD:${r}`, value])) }))
    }
    window.addEventListener('aman:apply-vtbd-workspace', apply)
    return () => window.removeEventListener('aman:apply-vtbd-workspace', apply)
  }, [])

  // Remote direction changes must discard local 21/03 controller targets too.
  // This resets only BD; the persisted flight row is retained for audit/recovery.
  useEffect(() => {
    resetAirportManualState('VTBD')
    window.dispatchEvent(new CustomEvent('aman:workspace-applied', { detail: { airport: 'VTBD' } }))
  }, [vtbdFlow])

  const setView = (view: AirportView) => {
    resetManualState()
    setAirportView(view)
    const selected = Object.values(view).filter(isAmanAirport)
    setInbound(current => current.filter(item => selected.includes(item.airport)))
    setLivePredictions(current => current.filter(item => selected.includes(rowAirport(item.id))))
  }
  useEffect(() => { window.dispatchEvent(new CustomEvent('aman:airport-selection-change')) }, [airportScope])

  const applyProfile = (airport: AirportCode, profileId: string) => {
    const profile = RUNWAY_PROFILES[airport].find((item) => item.id === profileId)
    if (!profile) return
    resetAirportManualState(airport)
    setProfileByAirport((current) => ({ ...current, [airport]: profileId }))
    const flow = vtbsFlowFromWorkspace(profile.modes)
    if (airport === 'VTBS') setVtbsFlow(flow)
    const bdFlow = vtbdFlowFromWorkspace(profile.modes)
    if (airport === 'VTBD') setVtbdFlow(bdFlow)
    setRunwayModes((current) => ({ ...current, [airport]: airport === 'VTBS'
      ? vtbsModesForFlow(profile.modes, flow) : airport === 'VTBD'
        ? vtbdModesForFlow(profile.modes, bdFlow) : { ...current[airport], ...profile.modes } }))
  }

  const setRunwayMode = (airport: AirportCode, runway: string, mode: RunwayMode) => {
    resetAirportManualState(airport)
    setProfileByAirport((current) => ({ ...current, [airport]: 'CUSTOM' }))
    setRunwayModes((current) => ({ ...current, [airport]: {
      ...current[airport],
      ...(isRegionalAirport(airport) && isArrivalMode(mode) ? Object.fromEntries(RUNWAYS[airport].map(r => [r, 'CLOSED'])) : {}),
      [runway]: mode,
    } }))
  }

  const setRunwaySpacing = (airport: AirportCode, runway: string, value: number) => {
    if (Number.isFinite(value) && value > 0) {
      setSpacingNm((current) => ({ ...current, [spacingKey(airport, runway)]: value }))
    }
  }

  const resetRunwaySpacing = (airport: AirportCode) => {
    setSpacingNm((current) => resetAirportSpacing(current, airport, vtbsFlow, vtbdFlow))
    window.dispatchEvent(new CustomEvent('aman:workspace-config-change', { detail: { airport } }))
  }

  const setOperationalState = (airport: AirportCode, callsign: string, state: OperationalState) => {
    const key = flightKey(airport, callsign)
    setOperationalStateByKey((current) => ({ ...current, [key]: state }))
    void postOperationalAction({ action: 'setOperationalState', airport, callsign, operationalState: state })
      .catch((error) => console.error('Operational state update failed', error))
  }

  const setOperationalGap = (row: AmanSequenceRow, seconds: number) => {
    const airport = rowAirport(row.id)
    const key = flightKey(airport, row.callsign)
    setReservedGapSecondsByKey((current) => {
      const next = { ...current }
      if (seconds > 0) next[key] = seconds
      else delete next[key]
      return next
    })
    setOpsMenu(null)
    void postOperationalAction({ action: 'setOperationalGap', airport, callsign: row.callsign, reservedGapSeconds: seconds })
      .catch((error) => console.error('Operational gap update failed', error))
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let disposed = false
    const loadOperationalConfig = async () => {
      try {
        const config = await readOperationalConfig()
        if (disposed) return
        setOperationalConfig(config)
        setOperationalConfigError(null)
      } catch (error) {
        if (disposed) return
        setOperationalConfigError(error instanceof Error ? error.message : String(error))
      }
    }
    const refresh = () => void loadOperationalConfig()
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('aman:force-shared-refresh', refresh)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('aman:force-shared-refresh', refresh)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    const loadTraffic = async (targetAirports: AirportCode[] = airports, announceAirport?: AirportCode) => {
      if (!announceAirport) setLoading(true)
      const results = await Promise.all(targetAirports.map(async (airport) => {
        try {
          if (isRegionalAirport(airport)) {
            const nav = await readRegionalNav(airport)
            if (disposed) return { airport, payload: null, resolved: [], error: null }
            registerRegionalFinalGeometry(nav.airport)
            setRegionalNav(current => ({ ...current, [airport]: nav }))
            const runway = activeRunwaysForAirport(airport, runwayModes)[0] || RUNWAYS[airport][0]
            const snapshot = await readRegionalSnapshot(nav, runway, true)
            const resolved = (snapshot.traffic.flights || []).map(flight => {
              const value = regionalPrediction(nav, snapshot, runway, approachByAirport[`${airport}:${runway}`], flight,
                latestPredictionState.current.canonicalEtaById[`${airport}:${flight.sessionId}`]
                || latestPredictionState.current.livePredictions.find(item => item.id === `${airport}:${flight.sessionId}`))
              const preview: InboundPreview = { airport, id: `${airport}:${flight.sessionId}`, flight, refFix: value.refFix,
                predictedIawpAt: value.prediction?.regional?.etaFfPassed ? null : value.prediction?.predictedIawpAt || null,
                source: 'REGIONAL EST', reason: value.reason, processingDistanceNm: value.distance }
              return { preview, prediction: value.prediction }
            })
            return { airport, payload: snapshot.traffic, resolved, error: null }
          }
          const payload = await readIvaoTraffic(airport)
          const resolved = await Promise.all((payload.flights ?? []).map(async (flight) => {
            const id = `${airport}:${flight.sessionId}`
            const distanceToBkk = processingDistanceNm(flight)
            const match = findAipIawp(airport, flight.route, [...ENTRY_FIXES[airport]])
            if (!match) return { preview: { airport, id, flight, refFix: null, predictedIawpAt: null, source: 'UNRESOLVED', reason: 'IAWP not resolved from filed route', processingDistanceNm: distanceToBkk } satisfies InboundPreview, prediction: null }
            const nominalSeconds = hasOperationalWorkspace(operationalConfig, airport, vtbsFlow, vtbdFlow)
              ? operationalTimings[airport][match.entryFix] ?? null
              : nominalStarSeconds(airport, match.entryFix, vtbsFlow, vtbdFlow)
            if (nominalSeconds == null) return { preview: { airport, id, flight, refFix: match.entryFix, predictedIawpAt: null, source: 'NO TIMING', reason: 'No nominal STAR timing configured', processingDistanceNm: distanceToBkk } satisfies InboundPreview, prediction: null }
            const [geometry, performancePayload] = await Promise.all([
              resolveRouteGeometry(flight, airport, match.entryFix),
              flight.aircraft ? readAircraftPerformance(flight.aircraft).catch(() => null) : Promise.resolve(null),
            ])
            const eta = estimateIawpArrival(flight, geometry, match.entryFix, nominalSeconds, payload.fetchedAt, performancePayload?.profile ?? null)
            const preview = { airport, id, flight, refFix: match.entryFix, predictedIawpAt: eta.predictedIawpAt, source: eta.source, reason: eta.reason, processingDistanceNm: distanceToBkk } satisfies InboundPreview
            const prediction: AmanArrivalPrediction | null = eta.predictedIawpAt ? {
              id,
              callsign: flight.callsign,
              aircraftType: flight.aircraft,
              wakeTurbulence: flight.wakeTurbulence,
              performanceCategory: performancePayload?.profile?.performanceCategory ?? null,
              runway: '',
              refFix: match.entryFix,
              predictedIawpAt: eta.predictedIawpAt,
              nominalStarSeconds: nominalSeconds,
              processingDistanceNm: distanceToBkk,
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
      const fetchedTimes = results.map((result) => result.payload?.fetchedAt).filter((value): value is string => Boolean(value)).sort()

      setInbound((current) => mergeAirportRefresh(current, previews, targetAirports, (item) => item.airport)
        .sort((a, b) => (a.predictedIawpAt || '9999').localeCompare(b.predictedIawpAt || '9999')))
      setLivePredictions((current) => {
        const old = new Map(current.map(item => [item.id, item]))
        const next = predictions.map(item => retainRegionalLock(old.get(item.id), item, Boolean(manualTldtRef.current[item.id])))
        return mergeAirportRefresh(current, next, targetAirports, (item) => rowAirport(item.id))
      })
      setTrafficErrorsByAirport((current) => {
        const next = { ...current }
        for (const result of results) {
          if (result.error) next[result.airport] = result.error
          else delete next[result.airport]
        }
        return next
      })
      setFetchedAt((current) => fetchedTimes.at(-1) ?? current)
      if (!announceAirport) setLoading(false)
      if (announceAirport) {
        const error = results.find((result) => result.airport === announceAirport)?.error ?? null
        window.dispatchEvent(new CustomEvent('aman:airport-recompute-finished', {
          detail: { airport: announceAirport, ok: !error, error },
        }))
      }
    }

    void loadTraffic()
    const refresh = window.setInterval(() => void loadTraffic(), AMAN_ETA_FF_REFRESH_MS)
    const onAirportRecompute = (event: Event) => {
      const detail = (event as CustomEvent<{ airport?: AirportCode; demo?: boolean }>).detail
      const airport = detail?.airport
      if (detail?.demo || !airport || !airports.includes(airport)) return
      for (const key of routeGeometryCache.keys()) {
        if (key.includes(`|${airport}|`)) routeGeometryCache.delete(key)
      }
      setCanonicalEtaById((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => rowAirport(id) !== airport),
      ))
      void loadTraffic([airport], airport)
    }
    window.addEventListener('aman:recompute-airport', onAirportRecompute)
    return () => {
      disposed = true
      window.clearInterval(refresh)
      window.removeEventListener('aman:recompute-airport', onAirportRecompute)
    }
  }, [airports, operationalConfig, operationalTimings, runwayModes, approachByAirport, vtbsFlow, vtbdFlow])

  useEffect(() => {
    if (!demoMode) return
    const withoutAirport = <T,>(current: Record<string, T>, airport: AirportCode) => Object.fromEntries(
      Object.entries(current).filter(([id]) => rowAirport(id) !== airport),
    ) as Record<string, T>
    const onDemoAirportRecompute = (event: Event) => {
      const detail = (event as CustomEvent<{ airport?: AirportCode; demo?: boolean }>).detail
      const airport = detail?.airport
      if (!detail?.demo || !airport || !airports.includes(airport)) return

      const anchor = new Date()
      anchor.setUTCSeconds(0, 0)
      setDemoAnchors((current) => current ? { ...current, [airport]: anchor } : current)
      setManualTldt((current) => withoutAirport(current, airport))
      setManualRunways((current) => withoutAirport(current, airport))
      setStableIds((current) => withoutAirport(current, airport))
      setAutoReturnFloorTldt((current) => withoutAirport(current, airport))
      if (dragRef.current && rowAirport(dragRef.current.id) === airport) dragRef.current = null
      setDraggingId((current) => current && rowAirport(current) === airport ? null : current)
      window.dispatchEvent(new CustomEvent('aman:airport-recompute-finished', {
        detail: { airport, ok: true, demo: true },
      }))
    }
    window.addEventListener('aman:recompute-airport', onDemoAirportRecompute)
    return () => window.removeEventListener('aman:recompute-airport', onDemoAirportRecompute)
  }, [airports, demoMode])

  const toggleDemo = () => {
    resetManualState()
    if (demoMode) {
      setDemoMode(false)
      setDemoAnchors(null)
      return
    }
    const anchor = new Date()
    anchor.setUTCSeconds(0, 0)
    setDemoAnchors({ VTBD: anchor, VTBS: anchor, VTCC: anchor, VTSP: anchor })
    setDemoMode(true)
  }

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, row: AmanSequenceRow) => {
    if (event.button !== 0) return
    event.preventDefault()
    setAutoReturnFloorTldt((current) => {
      if (!current[row.id]) return current
      const next = { ...current }
      delete next[row.id]
      return next
    })
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: row.id,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTldtMs: new Date(row.tldt).getTime(),
      moved: false,
    }
    setDraggingId(row.id)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>, row: AmanSequenceRow) => {
    const drag = dragRef.current
    if (!drag || drag.id !== row.id || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    if (!drag.moved && Math.abs(event.clientY - drag.startY) <= 3) return
    drag.moved = true
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
    if (!drag.moved) return
    if (row.regional) setLivePredictions(current => current.map(item => item.id === row.id ? retainRegionalLock(row, item, true) : item))
    setStableIds((current) => ({ ...current, [row.id]: true }))
  }

  const setFlightRunway = (row: AmanSequenceRow, runway: string) => {
    const airport = rowAirport(row.id)
    if (!activeRunwaysForAirport(airport, runwayModes).includes(runway)) return
    setAutoReturnFloorTldt((current) => {
      if (!current[row.id]) return current
      const next = { ...current }
      delete next[row.id]
      return next
    })
    setManualRunways((current) => ({ ...current, [row.id]: runway }))
    setManualTldt((current) => current[row.id] ? current : ({ ...current, [row.id]: row.tldt }))
    setStableIds((current) => ({ ...current, [row.id]: true }))
  }

  const resetRow = (row: AmanSequenceRow, floorAtCurrentTime = true) => {
    const floorMs = Math.ceil(Date.now() / DRAG_SNAP_MS) * DRAG_SNAP_MS
    const runwayOverrides = { ...(demoMode ? manualRunways : effectiveLiveRunways) }
    delete runwayOverrides[row.id]
    const resetPredictions = demoMode && demoAnchors
      ? airports.flatMap((airport) => buildDemoPredictions(
          airport,
          demoAnchors[airport],
          operationalTimings,
          hasOperationalWorkspace(operationalConfig, airport),
        ))
      : liveSequencedPredictions
    const resetAssigned = airports.flatMap((airport) => assignPredictionsToRunways(
      resetPredictions.filter((prediction) => rowAirport(prediction.id) === airport),
      airport,
      runwayModes,
      runwayOverrides,
    ))
    const autoBaseRow = autoSequenceUnstableArrivals(resetAssigned, {
      runwaySpacingSeconds,
      pairwiseSeparationSeconds: pairwiseLandingSeparationSeconds,
    }).find((candidate) => candidate.id === row.id)
    const autoBaseMs = autoBaseRow ? new Date(autoBaseRow.tldt).getTime() : NaN
    const autoTargetMs = floorAtCurrentTime
      ? Math.max(floorMs, Number.isFinite(autoBaseMs) ? autoBaseMs : floorMs)
      : autoBaseMs

    setAutoReturnFloorTldt((current) => {
      const next = { ...current }
      if (floorAtCurrentTime) {
        next[row.id] = new Date(floorMs).toISOString()
      } else {
        delete next[row.id]
      }
      return next
    })
    if (floorAtCurrentTime && Number.isFinite(autoTargetMs)) {
      const airport = rowAirport(row.id)
      window.dispatchEvent(new CustomEvent('aman:return-flight-auto', {
        detail: {
          airport,
          runway: autoBaseRow?.runway ?? row.runway,
          identity: amanSequenceOrderIdentity(airport, row.callsign),
          autoTldt: new Date(autoTargetMs).toISOString(),
          autoFloorTldt: new Date(floorMs).toISOString(),
        },
      }))
    }
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

  const applyOperationalStateToRow = (row: AmanSequenceRow, state: OperationalState) => {
    const airport = rowAirport(row.id)
    if (state !== 'NORMAL') resetRow(row, false)
    setOperationalState(airport, row.callsign, state)
    setOpsMenu(null)
  }

  const reinsertInbound = (item: DisplayInboundRow) => {
    setOperationalState(item.airport, item.callsign, 'NORMAL')
  }

  const configSummary = activeArrivalRunways.length
    ? activeArrivalRunways.map(({ airport, runway }) => `${airport.slice(2)}${runway} ${spacingNm[spacingKey(airport, runway)].toFixed(1)}NM`).join(' · ')
    : 'NO ARRIVAL RUNWAY'

  const opsMenuRow = opsMenu ? activeSequence.find((row) => row.id === opsMenu.rowId) ?? null : null

  return <div className={`aman-app${airports.length > 1 ? ' scope-both' : ''}`}>
    <header className="aman-topbar">
      <div className="aman-brand">
        <img src={ivaoThailandLogo} alt="IVAO Thailand" />
        <div className="aman-brand-copy"><span>Thailand Approach AMAN</span><strong>Arrival Sequencing</strong></div>
      </div>
      <div className="aman-session">
        <div className="aman-clock"><span>UTC</span><strong>{formatUtc(now)}</strong></div>
        <div className="aman-user"><strong>{user.name}</strong><span>VID {user.vid}</span></div>
        <a className="aman-preview-link" href="/?regional=VTCC">Route calculator</a>
        <a className="aman-signout" href="/api/auth/logout">Sign out</a>
      </div>
    </header>

    <section className="aman-control-strip aman-multi-runway-strip">
      <AirportSelector view={airportView} onChange={setView} />
      <div className="aman-runway-config-control">
        {airports.map((airport) => <div className="aman-runway-config-block" key={airport} data-airport={airport} data-runway-flow={airport === 'VTBS' ? vtbsFlow : airport === 'VTBD' ? vtbdFlow : undefined}>
          <div className="aman-profile-select">
            <span>{airport} CONFIG</span>
            <select aria-label={`${airport} configuration`} value={profileByAirport[airport]} onChange={(event) => applyProfile(airport, event.target.value)}>
              {profileByAirport[airport] === 'CUSTOM' && <option value="CUSTOM">CUSTOM</option>}
              {RUNWAY_PROFILES[airport].map((profile) => <option key={profile.id} value={profile.id}>{profile.id.replaceAll('_', ' · ')}</option>)}
            </select>
            <button
              type="button"
              className="aman-reset-spacing"
              title={`Restore ${airport} LAND SEP defaults`}
              onClick={() => resetRunwaySpacing(airport)}
            >RESET LAND SEP</button>
            {airport === 'VTBD' && vtbdFlow === '03' && !hasOperationalWorkspace(operationalConfig, airport, vtbsFlow, vtbdFlow)
              && <small title="Nominal A320 EST · AIRAC 2609 · STAR via DOTLI · ILS Z 03L / RNP 03R · no wind, vectors or holding">DOTLI · TIMING EST</small>}
          </div>
          {isRegionalAirport(airport) && <div className="aman-regional-approach"><label>Approach · EST
            <select data-regional-approach aria-label={`${airport} approach`} value={approachByAirport[`${airport}:${activeRunwaysForAirport(airport, runwayModes)[0] || RUNWAYS[airport][0]}`] || ''}
              onChange={event => {
                const runway = activeRunwaysForAirport(airport, runwayModes)[0] || RUNWAYS[airport][0]
                setApproachByAirport(current => ({ ...current, [`${airport}:${runway}`]: event.target.value }))
              }}>
              {(regionalNav[airport]?.airport.procedures || []).filter(p => p.kind === 'APPROACH' && p.runway === (activeRunwaysForAirport(airport, runwayModes)[0] || RUNWAYS[airport][0])).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              {!regionalNav[airport] && <option value={approachByAirport[`${airport}:${activeRunwaysForAirport(airport, runwayModes)[0] || RUNWAYS[airport][0]}`]}>Loading AIRAC…</option>}
            </select></label><small>STAR + SimBrief · LAND SEP configurable</small></div>}
          <div className="aman-runway-cards">
            {(airport === 'VTBS' ? VTBS_RUNWAY_GROUPS[vtbsFlow] : airport === 'VTBD' ? VTBD_RUNWAY_GROUPS[vtbdFlow] : RUNWAYS[airport]).map((runway) => {
              const mode = runwayModes[airport][runway]
              const arrivalEnabled = isArrivalMode(mode)
              return <div className={`aman-runway-card ${arrivalEnabled ? 'is-arrival' : ''}`} key={runway}>
                <b>{runway}</b>
                <select aria-label={`${airport} ${runway} mode`} value={mode} onChange={(event) => setRunwayMode(airport, runway, event.target.value as RunwayMode)}>
                  <option value="ARR">ARR</option><option value="DEP">DEP</option><option value="MIX">MIX</option><option value="CLOSED">CLOSED</option>
                </select>
                <label title={(airport === 'VTBS' && vtbsFlow === '01_02') || (airport === 'VTBD' && vtbdFlow === '03') ? 'Working default from reciprocal runway · controller configurable, not verified north-flow minima' : isRegionalAirport(airport) ? 'Experimental landing spacing · default 5 NM, controller configurable' : 'Target landing spacing'}>
                  <input aria-label={`${airport} ${runway} LAND SEP`} type="number" min="1" max="20" step="0.1" value={spacingNm[spacingKey(airport, runway)]} disabled={!arrivalEnabled} onChange={(event) => setRunwaySpacing(airport, runway, Number(event.target.value))} />
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
        <div className="aman-panel-header aman-timeline-header">
          <div className="aman-timeline-heading"><span className="aman-eyebrow">MAESTRO STYLE</span><h1>Arrival Timeline</h1></div>
          <button
            type="button"
            className={`aman-mobile-inbound-toggle${mobileInboundUnread ? ' has-unread' : ''}`}
            aria-expanded={mobileInboundOpen}
            aria-controls="aman-mobile-inbound"
            onClick={toggleMobileInbound}
          >INBOUND <b>{displayInboundRows.length}</b></button>
          <div className="aman-panel-meta">
            <span>5 MIN MAJOR</span><span>1 MIN MINOR</span>
            <span title={`MAESTRO processing coverage ${AMAN_PROCESSING_RADIUS_BAND_NM.MIN}-${AMAN_PROCESSING_RADIUS_BAND_NM.MAX} NM; project admission at outer edge`}>RADIUS {AMAN_PROCESSING_RADIUS_NM} NM</span>
            <span>ETA-FF {AMAN_ETA_FF_REFRESH_SECONDS} SEC</span>
            <label className="aman-history-control"><span>HISTORY</span><select value={historyMinutes} onChange={(event) => setHistoryMinutes(Number(event.target.value))}>{AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES.map((value) => <option key={value} value={value}>{value} MIN</option>)}</select></label>
            {(capacityOverload || matrixOverloadCount > 0) && <span className="aman-capacity-alert">OVERLOAD</span>}
            {activeGaCount > 0 && <span className="aman-ga-alert">GA {activeGaCount}</span>}
            <span className="aman-capacity-chip">AAR {capacitySummary}</span>
            <span className="is-drag-enabled">DRAG = SET TARGET · DBL CLICK = RETURN AUTO · RIGHT CLICK = OPS</span>
            <button type="button" className={`aman-demo-toggle ${demoMode ? 'is-active' : ''}`} onClick={toggleDemo}>{demoMode ? 'TEST TRAFFIC ON' : 'TEST TRAFFIC'}</button>
            <span className={demoMode ? 'is-simulated' : ''}>{demoMode ? 'SIMULATED' : loading ? 'LOADING' : 'IVAO LIVE'}</span>
          </div>
        </div>

        <div className="aman-timeline-stage">
          <div className="aman-time-axis" aria-hidden="true">{ticks.map((tick) => <div className={`aman-minute-tick ${tick.isMajor ? 'is-major' : 'is-minor'}`} key={tick.key} style={{ '--offset-px': `${tick.offsetPx}px` } as CSSProperties}>{tick.isMajor && <span>{tick.label}</span>}<i /></div>)}</div>
          <div className="aman-current-line"><span>ACTUAL {formatUtc(now)}</span></div>
          <div className="aman-flight-layer">
            {visibleProvisionalSequence.map((row) => {
              const offsetMinutes = (new Date(row.tldt).getTime() - now.getTime()) / 60_000
              const offsetPx = Math.round(-offsetMinutes * PX_PER_MINUTE)
              const airport = rowAirport(row.id)
              const phase = livePhaseById.get(row.id)
              return <div
                key={`provisional-${row.id}`}
                className="aman-provisional-row"
                data-airport={airport}
                style={{ '--offset-px': `${offsetPx}px` } as CSSProperties}
                title={`${phase === 'TAKEOFF_EST' ? 'AIRBORNE · ACTUAL TAKEOFF PENDING' : 'DEPARTING'} · PROVISIONAL ONLY · NOT IN SEQUENCE / AAR / HLD`}
              >
                <span className="tldt">{formatHms(row.tldt)}</span>
                <strong>{row.callsign}<small>{phase === 'TAKEOFF_EST' ? 'TAKEOFF EST' : 'DEPARTING EST'}</small></strong>
                <span>{row.aircraftType || '----'}</span>
                <span className={`fix-code ${compactFixClass(airport, row.refFix)}`}>{compactFix(airport, row.refFix)}</span>
                <span>{row.regional?.etaFfPassed ? 'PASSED' : formatHm(row.tto)}</span>
                <b>PROV</b>
                <em>{airports.length > 1 ? `${airport.slice(2)}/${row.runway}` : row.runway}</em>
              </div>
            })}
            {visibleSequence.map((row) => {
              const offsetMinutes = (new Date(row.tldt).getTime() - now.getTime()) / 60_000
              const isPast = offsetMinutes < 0
              const offsetPx = Math.round(-offsetMinutes * PX_PER_MINUTE)
              const isStable = Boolean(stableIds[row.id])
              const hasConflict = separationConflictIds.has(row.id)
              const isDragging = draggingId === row.id
              const airport = rowAirport(row.id)
              const selectableRunways = activeRunwaysForAirport(airport, runwayModes)
              const runwayLabel = airports.length > 1 ? `${airport.slice(2)}/${row.runway}` : row.runway
              const split = splitAmanDelay(row.delayMinutes)
              const matrix = getAmanOperationalMatrixAdvice(row.delayMinutes)
              const matrixClass = matrix.band.toLowerCase().replace(/_/g, '-')
              const gapSeconds = Math.max(0, gapAfterSecondsById[row.id] ?? 0)
              const autoBaselineRow = (demoMode ? demoBaseSequence : liveBaseSequence)
                .find((candidate) => candidate.id === row.id)
              const sharedFlight = sharedOperationalFlightByKey.get(flightKey(airport, row.callsign))
              const isMissedApproach = sharedFlight?.missed_approach_active === true

              return <div
                key={row.id}
                className={`aman-flight-row action-${row.delayAction.toLowerCase()} matrix-${matrixClass}${isPast ? ' is-past' : ''}${demoMode ? ' is-demo' : ''}${isStable ? ' is-stable' : ''}${hasConflict ? ' is-sep-conflict' : ''}${isDragging ? ' is-dragging' : ''}${isMissedApproach ? ' is-missed-approach' : ''}`}
                data-airport={airport}
                data-ref-fix={row.refFix}
                data-delay-minutes={row.delayMinutes}
                data-regional-stage={row.regional?.stage}
                data-regional-model={row.regional?.modelKey}
                data-regional-approach={row.regional ? approachByAirport[`${airport}:${row.runway}`] : undefined}
                data-eta-ff-passed={row.regional?.etaFfPassed ? 'true' : undefined}
                data-timing-model={row.regional ? 'EST' : undefined}
                data-matrix-band={matrix.band}
                data-gap-seconds={gapSeconds || undefined}
                data-target-mode={isStable ? 'MANUAL' : 'AUTO'}
                data-target-tldt={row.tldt}
                data-auto-baseline-tldt={autoBaselineRow?.tldt}
                data-auto-baseline-runway={autoBaselineRow?.runway}
                data-auto-baseline-rank={autoBaselineRow?.sequenceIndex}
                data-performance-category={row.performanceCategory || undefined}
                data-runway-flow={airport === 'VTBS' ? vtbsFlow : airport === 'VTBD' ? vtbdFlow : undefined}
                data-frozen-tldt={sharedFlight?.frozen_runway === row.runway ? sharedFlight.frozen_tldt || undefined : undefined}
                data-frozen-approach-category={sharedFlight?.frozen_approach_category || undefined}
                data-missed-approach-active={isMissedApproach ? 'true' : undefined}
                style={{ '--offset-px': `${offsetPx}px` } as CSSProperties}
                title={`Drag sets target · double-click returns AUTO · right-click operational actions · ETA-FF ${row.regional?.etaFfPassed ? 'PASSED' : formatHms(row.predictedIawpAt) + 'Z'} · STA/TLDT ${formatHms(row.tldt)}Z · STA-FF/TTO ${row.regional?.etaFfPassed ? 'PASSED' : formatHms(row.tto) + 'Z'} · TDLY ${formatDelay(split.tdlyMinutes)} min · EDLY ${formatSplit(split.edlyMinutes)} · ADLY ${formatSplit(split.adlyMinutes)} · ${matrix.primary} / ${matrix.secondary} / ${matrix.vectorLimit} · ${airport} RWY ${row.runway}${row.regional ? ' · EST — STAR + approach / SimBrief' : ''}${row.performanceCategory ? ` · PER ${row.performanceCategory}` : ''}${isStable ? ' · ATC manual / Stable' : ''}${manualRunways[row.id] ? ' · MANUAL RUNWAY' : ''}${gapSeconds ? ` · RESERVED GAP ${gapSeconds}s` : ''}${hasConflict ? ' · PAIRWISE SEPARATION INVARIANT FAILED' : ''}${isPast ? ' · TLDT PASSED · AWAITING LIVE LANDING CONFIRMATION' : ''}`}
                onPointerDown={(event) => startDrag(event, row)}
                onPointerMove={(event) => moveDrag(event, row)}
                onPointerUp={(event) => endDrag(event, row)}
                onPointerCancel={(event) => endDrag(event, row)}
                onDoubleClick={() => resetRow(row)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (!demoMode) setOpsMenu({ rowId: row.id, x: event.clientX, y: event.clientY })
                }}
              >
                <span className="tldt">{formatHms(row.tldt)}</span>
                <strong>{row.callsign}{isMissedApproach && <small className="aman-ga-badge">GA</small>}</strong>
                <span>{row.aircraftType || '----'}</span>
                <span className={`fix-code ${compactFixClass(airport, row.refFix)}`}>{compactFix(airport, row.refFix)}</span>
                <span>{row.regional?.etaFfPassed ? 'PASSED' : formatHm(row.tto)}</span>
                <b className="aman-delay-stack">
                  <span>{formatDelay(row.delayMinutes)}</span>
                  {row.delayMinutes < 0
                    ? <small className="aman-delay-split">GAIN {formatSplit(split.gainMinutes)}</small>
                    : <small className="aman-delay-split">E{formatSplit(split.edlyMinutes)} A{formatSplit(split.adlyMinutes)}</small>}
                  {matrix.band !== 'NORMAL' && matrix.band !== 'GAIN' && <small className={`aman-matrix-label matrix-${matrixClass}`}>{matrix.shortLabel}</small>}
                  {gapSeconds > 0 && <small className="aman-gap-label">GAP {Math.round(gapSeconds / 60)}M</small>}
                </b>
                <em className={`runway-assignment${manualRunways[row.id] ? ' is-manual' : ''}${matrix.band === 'CONSIDER_HOLD' ? ' is-runway-suggested' : ''}`}>
                  {selectableRunways.length > 1 ? <select
                    value={row.runway}
                    aria-label={`${row.callsign} landing runway`}
                    title={matrix.band === 'CONSIDER_HOLD' ? `Runway change is a MAESTRO secondary action at this delay band` : `Assign ${row.callsign} landing runway`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onChange={(event) => setFlightRunway(row, event.target.value)}
                  >
                    {selectableRunways.map((runway) => <option key={runway} value={runway}>{runway}</option>)}
                  </select> : runwayLabel}
                </em>
              </div>
            })}
          </div>
          {!loading && !visibleSequence.length && !demoMode && <div className="aman-empty-sequence">
            <strong>{trafficError ? 'LIVE TRAFFIC ERROR' : operationalQueueCount ? 'TRAFFIC DESEQUENCED / MISSED' : monitoredInboundCount ? 'INBOUND OUTSIDE PROCESSING RADIUS' : activeArrivalRunways.length ? 'NO SEQUENCEABLE INBOUND' : 'NO ARRIVAL RUNWAY ACTIVE'}</strong>
            <span>{trafficError || (operationalQueueCount ? `${operationalQueueCount} flight(s) are outside the active sequence by controller action. Use REINSERT in Inbound.` : monitoredInboundCount ? `${monitoredInboundCount} inbound monitored outside the ${AMAN_PROCESSING_RADIUS_NM} NM processing boundary.` : activeArrivalRunways.length ? `No live inbound inside the ${AMAN_PROCESSING_RADIUS_NM} NM processing boundary right now.` : 'Set at least one runway to ARR or MIX.')}</span>
          </div>}
        </div>
      </section>

      {mobileInboundOpen && <button type="button" className="aman-mobile-inbound-backdrop" aria-label="Close inbound traffic" onClick={() => setMobileInboundOpen(false)} />}
      <aside className="aman-side-stack">
        <section id="aman-mobile-inbound" className={`aman-panel aman-inbound-panel${mobileInboundOpen ? ' is-mobile-open' : ''}`}>
          <div className="aman-panel-header compact"><div><span className="aman-eyebrow">TRAFFIC</span><h2>Inbound</h2></div><div className="aman-inbound-header-actions"><span className={`aman-live-pill ${trafficError ? 'is-error' : ''} ${demoMode ? 'is-demo' : ''}`}>{demoMode ? 'TEST DATA' : trafficError ? 'API ERROR' : 'IVAO LIVE'}</span><button type="button" className="aman-mobile-inbound-close" aria-label="Close inbound traffic" onClick={() => setMobileInboundOpen(false)}>×</button></div></div>
          <div className="aman-inbound-list" role="region" aria-label="Inbound traffic" tabIndex={0}>
            <div className="aman-inbound-head multi"><span>APT</span><span>ACID</span><span>TYPE</span><span>IAWP</span><span>ETA-FF</span></div>
            {displayInboundRows.map((item) => <div className={`aman-inbound-row multi planning-${item.planningState.toLowerCase()}`} data-planning-state={item.planningState} data-airport={item.airport} data-predicted-tldt={livePredictionById.get(item.id)?.regional?.estimatedLandingAt} data-nominal-seconds={livePredictionById.get(item.id)?.nominalStarSeconds} key={item.id} title={item.title}>
              <span className="apt">{item.airport.slice(2)}</span>
              <div className="aman-inbound-acid">
                <strong className={stableIds[item.id] ? 'is-stable' : ''}>{item.callsign}</strong>
                {item.planningState === 'BOARDING' && <small className="aman-planning-badge is-boarding">BOARDING</small>}
                {item.planningState === 'DEPARTING' && <small className="aman-planning-badge is-departing">DEPARTING · EST</small>}
                {item.planningState === 'TAKEOFF_EST' && <small className="aman-planning-badge is-departing">TAKEOFF · EST</small>}
                {isRegionalAirport(item.airport) && !livePredictionById.has(item.id) && item.planningState === 'MONITORED' && <small className="aman-planning-badge is-departing">NO ETA · SEE INFO</small>}
                {item.planningState === 'MONITORED' && <small className="aman-planning-badge">MON{Number.isFinite(item.processingDistanceNm) ? ` ${Math.round(Number(item.processingDistanceNm))}NM` : ''}</small>}
                {item.planningState === 'MISSED' && <button type="button" className="aman-reinsert-button is-missed" onClick={() => reinsertInbound(item)}>MISSED · REINSERT</button>}
                {item.planningState === 'DESEQUENCED' && <button type="button" className="aman-reinsert-button" onClick={() => reinsertInbound(item)}>DSEQ · REINSERT</button>}
                {item.planningState === 'REMOVED' && <button type="button" className="aman-reinsert-button" onClick={() => reinsertInbound(item)}>REM · REINSERT</button>}
              </div>
              <span>{item.aircraft}</span><span>{item.refFix}</span><span>{livePredictionById.get(item.id)?.regional?.etaFfPassed ? 'PASSED' : formatHm(item.eta)}</span>
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
            <div><dt>Nominal timing</dt><dd className={operationalConfigError ? 'is-warning' : ''}>{operationalTimingCount ? `MASTER DATA · ${operationalTimingCount} FIX` : operationalConfigError ? 'CODE FALLBACK' : 'LOADING'}</dd></div>
            <div><dt>Processing radius</dt><dd>{AMAN_PROCESSING_RADIUS_BAND_NM.MIN}-{AMAN_PROCESSING_RADIUS_BAND_NM.MAX} NM · ENTRY {AMAN_PROCESSING_RADIUS_NM}</dd></div>
            <div><dt>Monitored inbound</dt><dd>{monitoredInboundCount}</dd></div>
            <div><dt>ETA-FF refresh</dt><dd>{AMAN_ETA_FF_REFRESH_SECONDS} SEC</dd></div>
            <div><dt>Live route ETA</dt><dd>{liveRouteCount}/{inbound.length}</dd></div>
            <div><dt>Delay splitting</dt><dd>TDLY → EDLY + ADLY</dd></div>
            <div><dt>AAR / demand</dt><dd className={capacityOverload ? 'is-warning' : ''}>{capacitySummary} / H</dd></div>
            <div><dt>Matrix overload</dt><dd className={matrixOverloadCount ? 'is-warning' : ''}>{matrixOverloadCount ? `${matrixOverloadCount} HOLD ALL` : 'NONE'}</dd></div>
            <div><dt>Operational queue</dt><dd className={operationalQueueCount ? 'is-warning' : ''}>{operationalQueueCount || 'NONE'}</dd></div>
            <div><dt>TMA model</dt><dd>50 NM BKK</dd></div>
            <div><dt>Sequence</dt><dd>CASCADE CONSTRAINED</dd></div>
            <div><dt>Runway allocation</dt><dd>VTBD CALLSIGN RULE · VTBS EARLIEST</dd></div>
            <div><dt>Pairwise SEP</dt><dd>FINAL SPECIAL → LAND SEP FALLBACK</dd></div>
            <div><dt>Manual runway</dt><dd>{Object.keys(manualRunways).length}</dd></div>
            <div><dt>VTBD X-RWY</dt><dd>FINAL SPECIAL / FOLLOWER RWY SEP</dd></div>
            <div><dt>VTBS X-RWY</dt><dd>FINAL SPECIAL / 1.0 MIN</dd></div>
            <div><dt>Manual stable</dt><dd>{Object.keys(stableIds).length}</dd></div>
            <div><dt>SEP invariant</dt><dd className={separationConflictIds.size ? 'is-warning' : ''}>{separationConflictIds.size ? 'FAILED' : 'OK'}</dd></div>
            <div><dt>Last update</dt><dd>{formatHm(fetchedAt)}Z</dd></div>
          </dl>
        </section>
      </aside>
    </main>

    {opsMenu && opsMenuRow && <div
      className="aman-ops-menu"
      style={{ left: Math.min(opsMenu.x, window.innerWidth - 230), top: Math.min(opsMenu.y, window.innerHeight - 330) }}
      onClick={(event) => event.stopPropagation()}
    >
      <header><strong>{opsMenuRow.callsign}</strong><span>{rowAirport(opsMenuRow.id)} · RWY {opsMenuRow.runway}</span></header>
      <button type="button" onClick={() => applyOperationalStateToRow(opsMenuRow, 'MISSED_APPROACH')}>Missed Approach</button>
      <button type="button" onClick={() => applyOperationalStateToRow(opsMenuRow, 'DESEQUENCED')}>Desequence</button>
      <button type="button" onClick={() => setOperationalGap(opsMenuRow, 60)}>Insert Gap +1 min</button>
      <button type="button" onClick={() => setOperationalGap(opsMenuRow, 120)}>Insert Gap +2 min</button>
      <button type="button" onClick={() => setOperationalGap(opsMenuRow, 0)}>Clear Reserved Gap</button>
      <button type="button" className="is-danger" onClick={() => applyOperationalStateToRow(opsMenuRow, 'REMOVED')}>Remove from Sequence</button>
      <small>Runway change uses the runway selector. Runway closure uses ARR/DEP/MIX/CLOSED above.</small>
    </div>}

    <footer className="aman-legend"><span>DELAY</span><i className="expedite" /> Expedite <i className="nothing" /> Nothing <i className="speed" /> Speed reduction <i className="stretch" /> Path stretching <i className="holding" /> Holding</footer>
  </div>
}
