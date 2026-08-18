import { classifyAmanDelay, type AmanDelayAction } from './amanConstants'

export type AmanStabilityState = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

export type AmanArrivalPrediction = {
  id: string
  callsign: string
  aircraftType: string | null
  wakeTurbulence: string | null
  runway: string
  refFix: string
  predictedIawpAt: string
  nominalStarSeconds: number
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

const toMillis = (iso: string) => {
  const value = new Date(iso).getTime()
  if (!Number.isFinite(value)) throw new Error(`Invalid UTC timestamp: ${iso}`)
  return value
}

const toIso = (millis: number) => new Date(millis).toISOString()

export function calculateArrivalMetrics(
  arrival: AmanArrivalPrediction,
  targetLandingAt: string,
): Omit<AmanSequenceRow, 'sequenceIndex' | 'autoShiftSeconds'> {
  const predictedIawpMs = toMillis(arrival.predictedIawpAt)
  const targetLandingMs = toMillis(targetLandingAt)
  const nominalMs = Math.max(0, arrival.nominalStarSeconds) * 1000
  const naturalLandingMs = predictedIawpMs + nominalMs
  const ttoMs = targetLandingMs - nominalMs
  const delaySeconds = Math.round((ttoMs - predictedIawpMs) / 1000)
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

function requiredSeparationSeconds(
  leader: AmanArrivalPrediction,
  follower: AmanArrivalPrediction,
  config: AmanSequenceConfig,
) {
  const runwayBaseSeconds = config.runwaySpacingSeconds[follower.runway]
  if (!Number.isFinite(runwayBaseSeconds) || runwayBaseSeconds < 0) {
    throw new Error(`Missing runway spacing for ${follower.runway}`)
  }

  if (!config.pairwiseSeparationSeconds) return runwayBaseSeconds
  const pairwise = config.pairwiseSeparationSeconds(leader, follower, runwayBaseSeconds)
  return Number.isFinite(pairwise) && pairwise >= 0 ? pairwise : runwayBaseSeconds
}

/**
 * Initial MAESTRO-style automatic planning for Unstable traffic.
 *
 * Flights are ordered by their natural predicted landing time with full timestamp precision.
 * The first flight keeps its natural TLDT. Each following flight is moved later only when
 * needed to satisfy the configured separation from the preceding flight on that runway.
 *
 * This function intentionally does not move Stable/Superstable/Frozen traffic. Those states
 * are handled by the later controller-confirm/resequence layer.
 */
export function autoSequenceUnstableArrivals(
  arrivals: AmanArrivalPrediction[],
  config: AmanSequenceConfig,
): AmanSequenceRow[] {
  const byRunway = new Map<string, AmanArrivalPrediction[]>()

  for (const arrival of arrivals) {
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

      const metrics = calculateArrivalMetrics(arrival, toIso(targetLandingMs))
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
    .map((row, index) => ({ ...row, sequenceIndex: index + 1 }))
}

export function averageDelayMinutes(rows: Pick<AmanSequenceRow, 'delayMinutes'>[]) {
  if (!rows.length) return 0
  return rows.reduce((sum, row) => sum + row.delayMinutes, 0) / rows.length
}
