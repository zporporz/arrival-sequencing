import { classifyAmanDelay, nmToMinutesAtReferenceSpeed, type AmanDelayAction } from './amanConstants'
import { cachedAircraftPerformanceCategory } from './aircraftPerformanceCategory'
import type { AircraftPerformanceCategory } from './api'

export type AmanStabilityState = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

export type AmanArrivalPrediction = {
  id: string
  callsign: string
  aircraftType: string | null
  wakeTurbulence: string | null
  performanceCategory?: AircraftPerformanceCategory | null
  runway: string
  refFix: string
  predictedIawpAt: string
  nominalStarSeconds: number
  processingDistanceNm?: number | null
}

export type AmanSequenceRow = AmanArrivalPrediction & {
  sequenceIndex: number
  naturalLandingAt: string
  tldt: string
  tto: string
  delaySeconds: number
  delayMinutes: number
  delayAction: AmanDelayAction
  autoShiftSeconds: number
}

export type AmanSequenceConfig = {
  runwaySpacingSeconds: Record<string, number>
  pairwiseSeparationSeconds?: (
    leader: AmanArrivalPrediction,
    follower: AmanArrivalPrediction,
    runwayBaseSeconds: number,
  ) => number
}

// Final approach spacing working rules supplied for the Thailand AMAN model.
// X following Y means X is the follower and Y is the leader.
const FINAL_APPROACH_SPACING = {
  B_BEHIND_B_SECONDS: 2 * 60,
  OTHER_BEHIND_B_SECONDS: 4 * 60,
  BEHIND_A380_NM: 7,
  B_BEHIND_A_NM: 7,
  CD_BEHIND_A_NM: 12,
} as const

// TEST TRAFFIC exercises the same pair-separation resolver as live traffic without
// waiting for an async SimBrief lookup. This mapping is used only for `demo:` rows;
// it never populates the live aircraft-performance cache.
const DEMO_PERFORMANCE_CATEGORY_BY_TYPE: Readonly<Record<string, AircraftPerformanceCategory>> = {
  A320: 'C',
  A321: 'C',
  A388: 'D',
  AT76: 'B',
  B738: 'C',
  B763: 'D',
}

// AppMaestroV24 creates the eight synthetic rows from these original natural-landing
// offsets. Recover the common test anchor from each prediction, then spread ETA-FF
// across the lifecycle bands. This keeps the scenario deterministic while allowing
// UNSTABLE, STABLE, SUPERSTABLE and FROZEN to be tested in one run.
const DEMO_ORIGINAL_LANDING_OFFSET_MINUTES = [8, 8.5, 9, 9.5, 10, 11, 13, 16] as const
const DEMO_ETA_FF_OFFSET_MINUTES = [26, 20, 16, 12, 8, 4, 2, null] as const
const DEMO_FROZEN_LANDING_OFFSET_MINUTES = 3

const manualSequenceOrder = new Map<string, number>()

export function amanSequenceOrderIdentity(airport: string, callsign: string) {
  return `${airport.trim().toUpperCase()}:${callsign.trim().toUpperCase()}`
}

function airportFromPredictionId(id: string) {
  const upper = id.toUpperCase()
  return upper.includes('VTBS') ? 'VTBS' : 'VTBD'
}

export function amanSequenceOrderKey(arrival: Pick<AmanArrivalPrediction, 'id' | 'callsign'>) {
  return amanSequenceOrderIdentity(airportFromPredictionId(arrival.id), arrival.callsign)
}

export function setAmanManualSequenceOrderSnapshot(snapshot: Readonly<Record<string, number>>) {
  manualSequenceOrder.clear()
  for (const [key, rank] of Object.entries(snapshot)) {
    if (Number.isFinite(rank) && rank > 0) manualSequenceOrder.set(key, rank)
  }
}

function sequenceOrderRank(arrival: Pick<AmanArrivalPrediction, 'id' | 'callsign'>, fallback: number) {
  return manualSequenceOrder.get(amanSequenceOrderKey(arrival)) ?? fallback
}

const toMillis = (iso: string) => {
  const value = new Date(iso).getTime()
  if (!Number.isFinite(value)) throw new Error(`Invalid UTC timestamp: ${iso}`)
  return value
}

const toIso = (millis: number) => new Date(millis).toISOString()

function lifecycleTestPrediction(arrival: AmanArrivalPrediction): AmanArrivalPrediction {
  const match = arrival.id.match(/^demo:(VTBD|VTBS):(\d+)$/i)
  if (!match) return arrival

  const index = Number(match[2])
  const originalLandingOffset = DEMO_ORIGINAL_LANDING_OFFSET_MINUTES[index]
  const etaFfOffset = DEMO_ETA_FF_OFFSET_MINUTES[index]
  if (originalLandingOffset == null || etaFfOffset === undefined) return arrival

  const nominalMs = Math.max(0, arrival.nominalStarSeconds) * 1000
  const originalNaturalLandingMs = toMillis(arrival.predictedIawpAt) + nominalMs
  const anchorMs = originalNaturalLandingMs - originalLandingOffset * 60_000
  const predictedIawpMs = etaFfOffset == null
    ? anchorMs + DEMO_FROZEN_LANDING_OFFSET_MINUTES * 60_000 - nominalMs
    : anchorMs + etaFfOffset * 60_000

  return { ...arrival, predictedIawpAt: toIso(predictedIawpMs) }
}

/**
 * Calculate timeline metrics for one planned landing target.
 *
 * Delay is a controller-planning value, not a live-performance error. The caller may
 * supply the TLDT that existed when ATC took control of the flight. If no planning
 * baseline is supplied (AUTO sequencing), the current target is its own baseline and
 * TDLY is therefore zero even when live ETA-FF/trajectory changes or automatic
 * separation moves the AUTO target.
 */
export function calculateArrivalMetrics(
  arrival: AmanArrivalPrediction,
  targetLandingAt: string,
  planningBaselineLandingAt: string = targetLandingAt,
): Omit<AmanSequenceRow, 'sequenceIndex' | 'autoShiftSeconds'> {
  const predictedIawpMs = toMillis(arrival.predictedIawpAt)
  const targetLandingMs = toMillis(targetLandingAt)
  const planningBaselineLandingMs = toMillis(planningBaselineLandingAt)
  const nominalMs = Math.max(0, arrival.nominalStarSeconds) * 1000
  const naturalLandingMs = predictedIawpMs + nominalMs
  const ttoMs = targetLandingMs - nominalMs
  const delaySeconds = Math.round((targetLandingMs - planningBaselineLandingMs) / 1000)
  const delayMinutes = delaySeconds / 60

  return {
    ...arrival,
    naturalLandingAt: toIso(naturalLandingMs),
    tldt: toIso(targetLandingMs),
    tto: toIso(ttoMs),
    delaySeconds,
    delayMinutes,
    delayAction: classifyAmanDelay(delayMinutes),
  }
}

function normalizedAircraftType(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase()
}

function isA380(value: string | null | undefined) {
  const type = normalizedAircraftType(value)
  return type === 'A380' || type === 'A388'
}

function performanceCategory(arrival: Pick<AmanArrivalPrediction, 'aircraftType' | 'performanceCategory'>) {
  if (arrival.performanceCategory) return arrival.performanceCategory

  const id = String((arrival as { id?: string }).id || '').toLowerCase()
  if (id.startsWith('demo:')) {
    return DEMO_PERFORMANCE_CATEGORY_BY_TYPE[normalizedAircraftType(arrival.aircraftType)] ?? null
  }

  return cachedAircraftPerformanceCategory(arrival.aircraftType)
}

/**
 * Returns the special final-approach spacing for the pair. A positive value replaces
 * normal LAND SEP for that listed pair. Zero means no special rule, so LAND SEP applies.
 * NM rules are converted to timeline seconds at the AMAN 140 kt final reference speed.
 */
export function finalApproachSpecialSeparationSeconds(
  leader: Pick<AmanArrivalPrediction, 'aircraftType' | 'performanceCategory'>,
  follower: Pick<AmanArrivalPrediction, 'aircraftType' | 'performanceCategory'>,
) {
  if (isA380(leader.aircraftType)) {
    return nmToMinutesAtReferenceSpeed(FINAL_APPROACH_SPACING.BEHIND_A380_NM) * 60
  }

  const leaderCategory = performanceCategory(leader)
  const followerCategory = performanceCategory(follower)

  if (leaderCategory === 'B') {
    return followerCategory === 'B'
      ? FINAL_APPROACH_SPACING.B_BEHIND_B_SECONDS
      : FINAL_APPROACH_SPACING.OTHER_BEHIND_B_SECONDS
  }

  if (leaderCategory === 'A') {
    if (followerCategory === 'B') {
      return nmToMinutesAtReferenceSpeed(FINAL_APPROACH_SPACING.B_BEHIND_A_NM) * 60
    }
    if (followerCategory === 'C' || followerCategory === 'D') {
      return nmToMinutesAtReferenceSpeed(FINAL_APPROACH_SPACING.CD_BEHIND_A_NM) * 60
    }
  }

  return 0
}

/**
 * One source of truth for pair spacing everywhere in the HMI. Listed final-approach
 * rules replace LAND SEP; otherwise the supplied landing separation is preserved.
 */
export function resolveAmanPairwiseSeparationSeconds(
  leader: Pick<AmanArrivalPrediction, 'aircraftType' | 'performanceCategory'>,
  follower: Pick<AmanArrivalPrediction, 'aircraftType' | 'performanceCategory'>,
  landingSeparationSeconds: number,
) {
  const landing = Number.isFinite(landingSeparationSeconds) && landingSeparationSeconds >= 0
    ? landingSeparationSeconds
    : 0
  const special = finalApproachSpecialSeparationSeconds(leader, follower)
  return special > 0 ? special : landing
}

function requiredSeparationSeconds(
  leader: AmanArrivalPrediction,
  follower: AmanArrivalPrediction,
  config: AmanSequenceConfig,
) {
  const runwayBaseSeconds = config.runwaySpacingSeconds[follower.runway]
  if (!Number.isFinite(runwayBaseSeconds) || runwayBaseSeconds < 0) {
    throw new Error(`Missing runway spacing for ${follower.runway}`)
  }

  const configuredPairwise = config.pairwiseSeparationSeconds
    ? config.pairwiseSeparationSeconds(leader, follower, runwayBaseSeconds)
    : runwayBaseSeconds
  const landingSeparation = Number.isFinite(configuredPairwise) && configuredPairwise >= 0
    ? configuredPairwise
    : runwayBaseSeconds

  return resolveAmanPairwiseSeparationSeconds(leader, follower, landingSeparation)
}

export function autoSequenceUnstableArrivals(
  arrivals: AmanArrivalPrediction[],
  config: AmanSequenceConfig,
): AmanSequenceRow[] {
  const byRunway = new Map<string, AmanArrivalPrediction[]>()

  for (const rawArrival of arrivals) {
    const arrival = lifecycleTestPrediction(rawArrival)
    const runway = arrival.runway.trim().toUpperCase()
    if (!runway) throw new Error(`Runway is required for ${arrival.callsign}`)
    const normalized = { ...arrival, runway }
    const bucket = byRunway.get(runway) ?? []
    bucket.push(normalized)
    byRunway.set(runway, bucket)
  }

  const rows: AmanSequenceRow[] = []

  for (const runwayArrivals of byRunway.values()) {
    const ordered = [...runwayArrivals].sort((a, b) => {
      const aNatural = toMillis(a.predictedIawpAt) + Math.max(0, a.nominalStarSeconds) * 1000
      const bNatural = toMillis(b.predictedIawpAt) + Math.max(0, b.nominalStarSeconds) * 1000
      return aNatural - bNatural || a.callsign.localeCompare(b.callsign)
    })

    let previous: AmanSequenceRow | null = null

    for (const arrival of ordered) {
      const naturalLandingMs = toMillis(arrival.predictedIawpAt) + Math.max(0, arrival.nominalStarSeconds) * 1000
      let targetLandingMs = naturalLandingMs

      if (previous) {
        const separationSeconds = requiredSeparationSeconds(previous, arrival, config)
        const earliestAllowedMs = toMillis(previous.tldt) + separationSeconds * 1000
        targetLandingMs = Math.max(targetLandingMs, earliestAllowedMs)
      }

      // AUTO sequencing establishes the planning baseline. It may move TLDT for
      // separation, but it must not manufacture controller delay on its own.
      const targetLandingAt = toIso(targetLandingMs)
      const metrics = calculateArrivalMetrics(arrival, targetLandingAt, targetLandingAt)
      const row: AmanSequenceRow = {
        ...metrics,
        sequenceIndex: 0,
        autoShiftSeconds: Math.max(0, Math.round((targetLandingMs - naturalLandingMs) / 1000)),
      }
      rows.push(row)
      previous = row
    }
  }

  return rows
    .sort((a, b) => toMillis(a.tldt) - toMillis(b.tldt) || a.callsign.localeCompare(b.callsign))
    .map((row, index) => {
      const result = { ...row } as AmanSequenceRow
      Object.defineProperty(result, 'sequenceIndex', {
        enumerable: true,
        configurable: true,
        get: () => sequenceOrderRank(result, index + 1),
      })
      return result
    })
}

export function averageDelayMinutes(rows: Pick<AmanSequenceRow, 'delayMinutes'>[]) {
  if (!rows.length) return 0
  return rows.reduce((sum, row) => sum + row.delayMinutes, 0) / rows.length
}
