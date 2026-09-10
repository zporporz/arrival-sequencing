import type { AmanArrivalPrediction, RegionalArrivalState } from './arrivalSequencing'
import type { IvaoArrivalTrafficFlight } from './api'
import { calculateRegionalTiming, regionalDistanceNm, resolveRegionalStar, type RegionalNavPayload } from './regionalArrivalModel'
import { estimateRegionalLive } from './regionalLiveEstimate'
import type { RegionalSnapshot } from './regionalPreviewData'

export function regionalPrediction(nav: RegionalNavPayload, snapshot: RegionalSnapshot, runway: string, approachName: string, flight: IvaoArrivalTrafficFlight, locked?: Pick<AmanArrivalPrediction, 'predictedIawpAt' | 'regional'>) {
  const star = resolveRegionalStar(nav.airport, runway, flight.route)
  const approach = nav.airport.procedures.find(p => p.kind === 'APPROACH' && p.runway === runway && p.name === approachName)
  const profile = snapshot.profiles[flight.aircraft || '']
  const result = star && approach ? calculateRegionalTiming(nav.airport, star, approach, profile) : null
  const live = result?.timing && profile ? estimateRegionalLive(flight, result.timing, profile, snapshot.routes[flight.sessionId] || null, snapshot.traffic.fetchedAt) : null
  const modelKey = star && approach && profile ? [nav.cycle, runway, star.id, approach.id, profile.aircraftType, profile.descentProfile].join('|') : ''
  const old = locked?.regional
  const trackAge = Date.parse(snapshot.traffic.fetchedAt) - Date.parse(flight.trackTimestamp || '')
  const keepLock = result?.timing && old && old.modelKey === modelKey && old.stage !== 'UNSTABLE'
    && Number.isFinite(Date.parse(locked!.predictedIawpAt)) && flight.onGround === false
    && !['landed', 'onblocks'].includes((flight.state || '').toLowerCase().replaceAll(' ', ''))
    && trackAge >= -15000 && trackAge <= 90000
  const reason = keepLock && !live?.estimate ? 'LOCKED EST — awaiting published route reacquisition' : !star ? 'STAR unresolved for selected runway' : !approach ? 'Select approach' : result?.error || live?.error || ''
  const distance = flight.latitude != null && flight.longitude != null
    ? regionalDistanceNm({ lat: flight.latitude, lon: flight.longitude }, nav.airport) : null
  let prediction: AmanArrivalPrediction | null = null
  const estimate = live?.estimate || (keepLock ? { etaFfMs: old!.etaFfPassed ? null : Date.parse(locked!.predictedIawpAt), tldtMs: Date.parse(old!.estimatedLandingAt), pastEntry: old!.etaFfPassed } : null)
  if (estimate && result?.timing && profile && star && approach) {
    const timing = result.timing
    // For a late join AFTER entry, this is only an arithmetic planning anchor.
    // Never display it as a recorded/observed FF crossing: the UI says PASSED.
    const anchor = estimate.etaFfMs ?? estimate.tldtMs - timing.nominalSeconds * 1000
    const minutesToEntry = (anchor - Date.parse(snapshot.traffic.fetchedAt)) / 60_000
    const regional: RegionalArrivalState = {
      modelKey,
      callsign: flight.callsign, runway, estimatedLandingAt: new Date(estimate.tldtMs).toISOString(),
      nominalStarSeconds: timing.nominalSeconds, etaFfPassed: estimate.pastEntry,
      stage: estimate.pastEntry || minutesToEntry <= 5 ? 'SUPERSTABLE' : minutesToEntry <= 15 ? 'STABLE' : 'UNSTABLE',
    }
    prediction = { id: `${nav.airport.code}:${flight.sessionId}`, callsign: flight.callsign, aircraftType: flight.aircraft,
      wakeTurbulence: flight.wakeTurbulence, performanceCategory: profile.performanceCategory, runway,
      refFix: timing.entry.fix || star.name, predictedIawpAt: new Date(anchor).toISOString(),
      nominalStarSeconds: timing.nominalSeconds, processingDistanceNm: distance, regional }
  }
  if (prediction && keepLock) prediction = { ...prediction, predictedIawpAt: locked!.predictedIawpAt,
    nominalStarSeconds: old!.nominalStarSeconds, regional: { ...old!, etaFfPassed: old!.etaFfPassed || prediction.regional!.etaFfPassed,
      stage: old!.stage === 'SUPERSTABLE' || prediction.regional!.stage === 'SUPERSTABLE' ? 'SUPERSTABLE' : 'STABLE' } }
  return { prediction, reason, distance, refFix: result?.timing?.entry.fix || star?.legs[0]?.fix || null }
}

/** Local fallback while a room connects. The room's durable snapshot wins as soon
 * as it arrives. Model/runway/session changes cannot inherit another lock. */
export function retainRegionalLock(previous: AmanArrivalPrediction | undefined, incoming: AmanArrivalPrediction, manual = false): AmanArrivalPrediction {
  if (!incoming.regional) return incoming
  const old = previous?.regional
  if (old && previous!.id === incoming.id && old.modelKey === incoming.regional.modelKey && old.stage !== 'UNSTABLE') {
    return { ...incoming, predictedIawpAt: previous!.predictedIawpAt, nominalStarSeconds: previous!.nominalStarSeconds,
      regional: { ...old, etaFfPassed: old.etaFfPassed || incoming.regional.etaFfPassed,
        stage: old.stage === 'SUPERSTABLE' || incoming.regional.stage === 'SUPERSTABLE' ? 'SUPERSTABLE' : 'STABLE' } }
  }
  return manual && incoming.regional.stage === 'UNSTABLE'
    ? { ...incoming, regional: { ...incoming.regional, stage: 'STABLE' } } : incoming
}
