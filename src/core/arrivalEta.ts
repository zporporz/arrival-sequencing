import type { AircraftPerformanceProfile, IvaoArrivalTrafficFlight } from './api'
import { standardTaxiOutMinutes } from './standardTaxiTime'
import {
  estimateIawpArrival as estimateIawpArrivalLegacy,
  secondsOfDayToNearestUtc,
  type ArrivalEtaEstimate,
  type ArrivalEtaSource,
  type Coordinates,
  type RouteGeometry,
  type RoutePoint,
  type RouteSegment,
} from './arrivalEtaLegacy'

export type {
  ArrivalEtaEstimate,
  ArrivalEtaSource,
  Coordinates,
  RouteGeometry,
  RoutePoint,
  RouteSegment,
}
export { secondsOfDayToNearestUtc }

type EtaStageState = {
  phase: 'GROUND' | 'AIRBORNE'
  displayedMs: number | null
  offBlockMs: number | null
  dynamicAirborneLatched: boolean
  touchedAtMs: number
}

const stageStateByFlight = new Map<string, EtaStageState>()
const MAX_STAGE_STATE_KEYS = 1000
const STAGE_STORAGE_PREFIX = 'aman-eta-stage-v1:'
const STAGE_STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const AIRBORNE_DYNAMIC_FL300_FT = 30_000
const AIRBORNE_CRUISE_CAPTURE_TOLERANCE_FT = 1_000
const AIRBORNE_DYNAMIC_DEADBAND_MS = 30_000

export function resetArrivalEtaStageState() {
  stageStateByFlight.clear()
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeTime(value: string | null | undefined) {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function flightStateKey(flight: IvaoArrivalTrafficFlight) {
  return String(flight.sessionId || `${flight.callsign}:${flight.departure || ''}:${flight.arrival || ''}`).trim().toUpperCase()
}

function storageKey(key: string) {
  return `${STAGE_STORAGE_PREFIX}${key}`
}

function loadPersistedStageState(key: string, nowMs: number): EtaStageState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<EtaStageState>
    if ((parsed.phase !== 'GROUND' && parsed.phase !== 'AIRBORNE') || !finite(parsed.touchedAtMs)) return null
    if (nowMs - parsed.touchedAtMs > STAGE_STORAGE_MAX_AGE_MS) {
      window.localStorage.removeItem(storageKey(key))
      return null
    }
    return {
      phase: parsed.phase,
      displayedMs: finite(parsed.displayedMs) ? parsed.displayedMs : null,
      offBlockMs: finite(parsed.offBlockMs) ? parsed.offBlockMs : null,
      dynamicAirborneLatched: parsed.dynamicAirborneLatched === true,
      touchedAtMs: parsed.touchedAtMs,
    }
  } catch {
    return null
  }
}

function persistStageState(key: string, state: EtaStageState) {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(state))
  } catch {
    // Persistence is a stability aid only. The in-memory stage model still works.
  }
}

function trimStageState() {
  while (stageStateByFlight.size > MAX_STAGE_STATE_KEYS) {
    const first = stageStateByFlight.keys().next().value
    if (first == null) break
    stageStateByFlight.delete(first)
  }
}

function isAirborne(flight: IvaoArrivalTrafficFlight) {
  if (flight.onGround === false) return true
  const state = String(flight.state || '').trim().toLowerCase()
  return state === 'initial climb' || state === 'en route' || state === 'approach'
}

function isDeparting(flight: IvaoArrivalTrafficFlight) {
  return String(flight.state || '').trim().toLowerCase() === 'departing'
}

function dynamicAirborneTriggerFt(flight: IvaoArrivalTrafficFlight) {
  const filedCruiseFt = finite(flight.filedCruiseAltitudeFt) && flight.filedCruiseAltitudeFt > 0
    ? flight.filedCruiseAltitudeFt
    : null
  if (filedCruiseFt == null) return AIRBORNE_DYNAMIC_FL300_FT
  return Math.min(
    AIRBORNE_DYNAMIC_FL300_FT,
    Math.max(0, filedCruiseFt - AIRBORNE_CRUISE_CAPTURE_TOLERANCE_FT),
  )
}

function estimateFromTakeoff(
  flight: IvaoArrivalTrafficFlight,
  nominalStarSeconds: number,
  referenceIso: string,
) {
  if (!finite(flight.filedEetSeconds) || flight.filedEetSeconds <= 0) return null

  const actualIso = flight.actualDepartureTimeSeconds != null
    ? secondsOfDayToNearestUtc(flight.actualDepartureTimeSeconds, referenceIso)
    : null
  const takeoffMs = safeTime(actualIso) ?? safeTime(flight.trackedTakeoffAt)
  if (takeoffMs == null) return null

  return takeoffMs + Math.max(0, flight.filedEetSeconds - nominalStarSeconds) * 1000
}

function groundStageEstimate(
  flight: IvaoArrivalTrafficFlight,
  nominalStarSeconds: number,
  fetchedAt: string,
  state: EtaStageState,
): ArrivalEtaEstimate | null {
  if (!finite(flight.filedEetSeconds) || flight.filedEetSeconds <= 0) return null

  const sttMinutes = standardTaxiOutMinutes(flight.departure)
  if (sttMinutes == null) return null

  const nowMs = safeTime(fetchedAt) ?? Date.now()
  const referenceIso = flight.connectedAt || fetchedAt
  const filedEobtIso = flight.filedDepartureTimeSeconds != null
    ? secondsOfDayToNearestUtc(flight.filedDepartureTimeSeconds, referenceIso)
    : null
  const filedEobtMs = safeTime(filedEobtIso)
  const taxiMs = sttMinutes * 60_000

  let etotMs: number
  let stageLabel: string
  const currentlyDeparting = isDeparting(flight)
  const departingLatched = currentlyDeparting || state.offBlockMs != null

  if (departingLatched) {
    if (state.offBlockMs == null) {
      state.offBlockMs = safeTime(flight.trackTimestamp) ?? nowMs
    }
    const plannedEtotMs = state.offBlockMs + taxiMs
    // Once IVAO has reported Departing for this flight, offBlockMs becomes a one-way
    // ground-stage latch. A later temporary Boarding label must not return the ETA model
    // to EOBT/NOW; keep using the original observed AOBT until the flight becomes airborne.
    // Once the standard taxi time has expired and the aircraft is still on the ground,
    // keep ETOT current so real taxi delay propagates into ELDT/ETO instead of freezing.
    etotMs = Math.max(plannedEtotMs, nowMs)
    stageLabel = `DEPARTING${currentlyDeparting ? '' : ' LATCHED'} AOBT+STT ${sttMinutes}MIN${nowMs > plannedEtotMs ? ' · TAXI OVERRUN→NOW' : ''}`
  } else {
    // Boarding: if filed EOBT is already overdue, NOW is the best current off-block
    // estimate. This avoids carrying an already-expired EOBT through the entire model.
    const estimatedOffBlockMs = Math.max(filedEobtMs ?? nowMs, nowMs)
    etotMs = estimatedOffBlockMs + taxiMs
    stageLabel = `BOARDING ${filedEobtMs != null && filedEobtMs >= nowMs ? 'EOBT' : 'NOW'}+STT ${sttMinutes}MIN`
  }

  const etoMs = etotMs + Math.max(0, flight.filedEetSeconds - nominalStarSeconds) * 1000
  state.phase = 'GROUND'
  state.displayedMs = etoMs
  state.touchedAtMs = nowMs

  return {
    source: 'FILED_EOBT_EET',
    predictedIawpAt: new Date(etoMs).toISOString(),
    confidence: departingLatched ? 'MEDIUM' : 'LOW',
    remainingNm: null,
    offRouteNm: null,
    groundSpeedKt: null,
    pastCrossing: false,
    reason: `ETA STAGE ${stageLabel} · EET ${(flight.filedEetSeconds / 60).toFixed(1)}MIN · STAR ${(nominalStarSeconds / 60).toFixed(1)}MIN`,
    modelPhase: 'FALLBACK',
  }
}

/**
 * Stage-based ETA-FF display model.
 *
 * Ground:
 *   BOARDING  -> max(EOBT, NOW) + STT + EET - STAR
 *   DEPARTING -> AOBT(first observed IVAO Departing) + STT + EET - STAR;
 *                once entered, DEPARTING is latched and cannot return to BOARDING;
 *                if still ground after that ETOT, NOW becomes ETOT so taxi delay propagates.
 *
 * Airborne:
 *   ATOT + EET - STAR establishes the stage baseline. The legacy LIVE model continues
 *   calculating every refresh. Before the aircraft reaches FL300 or its filed cruise
 *   altitude (with capture tolerance), the displayed ETA-FF retains monotonic-earlier
 *   takeoff protection. Crossing that trigger latches dynamic mode for the rest of the
 *   flight, allowing LIVE ETA to move earlier or later through climb, cruise and descent.
 */
export function estimateIawpArrival(
  flight: IvaoArrivalTrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  nominalStarSeconds: number,
  fetchedAt: string,
  performance: AircraftPerformanceProfile | null = null,
): ArrivalEtaEstimate {
  const key = flightStateKey(flight)
  const nowMs = safeTime(fetchedAt) ?? Date.now()
  const existing = stageStateByFlight.get(key)
    ?? loadPersistedStageState(key, nowMs)
    ?? {
      phase: 'GROUND' as const,
      displayedMs: null,
      offBlockMs: null,
      dynamicAirborneLatched: false,
      touchedAtMs: nowMs,
    }
  existing.touchedAtMs = nowMs
  stageStateByFlight.set(key, existing)
  trimStageState()

  if (!isAirborne(flight)) {
    const ground = groundStageEstimate(flight, nominalStarSeconds, fetchedAt, existing)
    persistStageState(key, existing)
    if (ground) return ground
    return estimateIawpArrivalLegacy(flight, geometry, refFix, nominalStarSeconds, fetchedAt, performance)
  }

  const legacy = estimateIawpArrivalLegacy(flight, geometry, refFix, nominalStarSeconds, fetchedAt, performance)
  const referenceIso = flight.connectedAt || fetchedAt
  const takeoffBaselineMs = estimateFromTakeoff(flight, nominalStarSeconds, referenceIso)
  const legacyMs = safeTime(legacy.predictedIawpAt)
  const triggerFt = dynamicAirborneTriggerFt(flight)
  const altitudeFt = finite(flight.altitude) && flight.altitude >= 0 ? flight.altitude : null
  const wasDynamic = existing.dynamicAirborneLatched
  // A controller/browser can join after the aircraft has already left cruise and
  // descended below the altitude trigger. In that case it never observed the
  // FL300/cruise crossing, so an altitude-only latch leaves different clients in
  // different ETA stages for the same live flight. Descent is conclusive evidence
  // that the flight has reached the post-climb dynamic phase; latch it immediately
  // so late-joining clients accept the same bidirectional LIVE ETA.
  const descentStageObserved = legacy.modelPhase === 'DESCENT'
  if (!wasDynamic && ((altitudeFt != null && altitudeFt >= triggerFt) || descentStageObserved)) {
    existing.dynamicAirborneLatched = true
  }
  const dynamicJustLatched = !wasDynamic && existing.dynamicAirborneLatched

  // The airborne stage starts fresh from actual takeoff information. If LIVE already
  // predicts an earlier ETO at the first airborne observation, accept that immediately.
  const candidates = [takeoffBaselineMs, legacyMs].filter((value): value is number => value != null)
  const candidateMs = candidates.length ? Math.min(...candidates) : null
  let dynamicDeadbandHeld = false

  if (existing.phase !== 'AIRBORNE') {
    existing.phase = 'AIRBORNE'
    existing.offBlockMs = null
    existing.displayedMs = existing.dynamicAirborneLatched && legacyMs != null
      ? legacyMs
      : candidateMs
  } else if (existing.dynamicAirborneLatched) {
    if (legacyMs != null) {
      const differenceMs = existing.displayedMs == null
        ? Number.POSITIVE_INFINITY
        : Math.abs(legacyMs - existing.displayedMs)
      if (dynamicJustLatched || differenceMs >= AIRBORNE_DYNAMIC_DEADBAND_MS) {
        existing.displayedMs = legacyMs
      } else {
        dynamicDeadbandHeld = true
      }
    } else if (existing.displayedMs == null) {
      existing.displayedMs = takeoffBaselineMs
    }
  } else if (candidateMs != null) {
    existing.displayedMs = existing.displayedMs == null
      ? candidateMs
      : Math.min(existing.displayedMs, candidateMs)
  }
  persistStageState(key, existing)

  if (existing.displayedMs == null) return legacy

  const displayedIso = new Date(existing.displayedMs).toISOString()
  const heldLaterLive = legacyMs != null && legacyMs > existing.displayedMs
  const acceptedEarlier = legacyMs != null && legacyMs <= existing.displayedMs
  const baselineLabel = takeoffBaselineMs != null ? new Date(takeoffBaselineMs).toISOString() : 'NA'
  const altitudeLabel = altitudeFt == null ? 'NA' : `${Math.round(altitudeFt)}FT`
  const etaStageLabel = existing.dynamicAirborneLatched
    ? `AIRBORNE DYNAMIC LATCHED${descentStageObserved ? ' · DESCENT OBSERVED' : ''}${dynamicDeadbandHeld ? ' · DEADBAND HELD' : ' · LIVE BOTH-DIRECTIONS'} · ALT ${altitudeLabel} · TRIGGER ${Math.round(triggerFt)}FT`
    : `AIRBORNE MONOTONIC ${heldLaterLive ? 'HELD EARLIER DISPLAY' : acceptedEarlier ? 'ACCEPTED EARLIER/EQUAL LIVE' : 'TAKEOFF BASELINE'} · ALT ${altitudeLabel} · TRIGGER ${Math.round(triggerFt)}FT`

  return {
    ...legacy,
    predictedIawpAt: displayedIso,
    reason: `${legacy.reason || 'ETA LIVE'} · ${etaStageLabel} · ATOT BASE ${baselineLabel}`,
  }
}
