from pathlib import Path

panel_path = Path('src/IvaoTrafficPanel.tsx')
readme_path = Path('README.md')

panel = panel_path.read_text(encoding='utf-8')

old_type = """  connectedAt: string | null\n  airlineIcao: string | null\n}\n"""
new_type = """  connectedAt: string | null\n  airlineIcao: string | null\n  departureCountryId: string | null\n  arrivalCountryId: string | null\n  isDomesticThailand: boolean\n  filedEetSeconds: number | null\n  trackedTakeoffAt: string | null\n  filedDestinationEtaAt: string | null\n  domesticTriggerStatus: 'READY' | 'WAITING_TAKEOFF' | 'EET_UNAVAILABLE' | 'TAKEOFF_UNAVAILABLE' | 'NOT_DOMESTIC' | 'UNKNOWN'\n}\n"""
if old_type not in panel:
    raise SystemExit('TrafficFlight type marker not found')
panel = panel.replace(old_type, new_type, 1)

old_auto_type = """  pastCrossing?: boolean\n  crossingAgeMin?: number | null\n  assumedDirect?: boolean\n}\n"""
new_auto_type = """  pastCrossing?: boolean\n  crossingAgeMin?: number | null\n  assumedDirect?: boolean\n  triggerSource?: 'live-route' | 'domestic-eet'\n  triggerEta?: string | null\n}\n"""
if old_auto_type not in panel:
    raise SystemExit('AutoEstimate type marker not found')
panel = panel.replace(old_auto_type, new_auto_type, 1)

start = panel.index('function autoEstimate(')
end = panel.index('\nfunction estimateText(', start)
new_auto = r'''function autoEstimate(
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
'''
panel = panel[:start] + new_auto + panel[end:]

start = panel.index('function estimateText(')
end = panel.index('\nexport default function IvaoTrafficPanel', start)
new_estimate = r'''function estimateText(estimate: AutoEstimate | undefined, manual: boolean, lookaheadMin: number) {
  if (!estimate) return 'AUTO ETO · waiting for route data'
  const domesticEta = estimate.triggerSource === 'domestic-eet' && estimate.triggerEta
    ? ' · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z'
    : ''

  if (manual) {
    if (estimate.status === 'ready') {
      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + domesticEta
      if (estimate.pastCrossing) return 'MANUAL ETO · estimated past crossing ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + domesticEta
      return 'MANUAL ETO · auto estimate ' + estimate.eto + 'Z available' + domesticEta
    }
    return 'MANUAL ETO · automatic estimate not applied'
  }
  if (estimate.status === 'ready') {
    if (estimate.assumedDirect) {
      const past = estimate.pastCrossing ? ' · EST PAST XING' : ''
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · REF FIX NOT FILED · ASSUMED DCT' + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
    }
    if (estimate.pastCrossing) {
      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · EST PAST XING · ~' + Math.round(estimate.remainingNm || 0) + ' NM / ' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
    }
    return 'AUTO ETO · ' + estimate.refFix + ' ' + estimate.eto + 'Z · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
  }
  if (estimate.status === 'waiting') {
    if (estimate.reason === 'Domestic flight waiting for tracked takeoff') {
      return 'AUTO ETO waiting · TH DOMESTIC · waiting for tracked wheels-off + filed EET'
    }
    if (estimate.triggerSource === 'domestic-eet' && estimate.triggerEta) {
      const minutes = Math.max(0, Math.ceil(estimate.minutes || 0))
      const assumed = estimate.assumedDirect ? ' · REF FIX NOT FILED · ASSUMED DCT' : ''
      return 'AUTO ETO waiting · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z · ~' + minutes + ' min' + assumed + ' · auto-fill starts ETA ≤' + lookaheadMin + ' min'
    }
    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED · ASSUMED DCT · ETA >' + lookaheadMin + ' min'
    if (estimate.pastCrossing) return 'AUTO ETO waiting · ' + estimate.refFix + ' already passed ~' + Math.max(1, Math.round(estimate.crossingAgeMin || 0)) + ' min ago · ETA >' + lookaheadMin + ' min'
    return 'AUTO ETO waiting · ~' + Math.ceil(estimate.minutes || 0) + ' min to destination · auto-fill starts ETA ≤' + lookaheadMin + ' min'
  }
  if (estimate.status === 'calculating') return 'AUTO ETO · ' + (estimate.reason || 'calculating')
  return 'AUTO ETO unavailable · ' + (estimate.reason || 'insufficient data')
}
'''
panel = panel[:start] + new_estimate + panel[end:]

old_heading = "AUTO ETO uses filed-route distance + live GS. If the selected REF FIX is not filed, the system may extend the filed route with an assumed DCT to that fix and labels the estimate accordingly."
new_heading = "AUTO ETO uses filed-route distance + live GS. Thailand domestic flights use tracked wheels-off + filed EET for the look-ahead trigger. If the selected REF FIX is not filed, the system may extend the filed route with an assumed DCT to that fix and labels the estimate accordingly."
if old_heading not in panel:
    raise SystemExit('IVAO heading marker not found')
panel = panel.replace(old_heading, new_heading, 1)

panel_path.write_text(panel, encoding='utf-8')

readme = readme_path.read_text(encoding='utf-8')
old_readme = """The trigger is based on estimated time remaining to the **destination**, while the ETO value itself is calculated for the selected **REF FIX**.\n\n## 16. Passed REF FIX back-estimation\n"""
new_readme = """The trigger is based on estimated time remaining to the **destination**, while the ETO value itself is calculated for the selected **REF FIX**.\n\n### Thailand domestic EET-after-takeoff trigger\n\nFor Thailand domestic flights (`departure.countryId = TH` and `arrival.countryId = TH`), the look-ahead trigger uses IVAO Tracker data instead of deriving destination ETA only from the aircraft's current groundspeed:\n\n```text\nIVAO latest flight plan → filed EET\nIVAO track history → first onGround true → false transition\ntracked wheels-off timestamp + filed EET\n        ↓\nfiled destination ETA baseline\n        ↓\nETA ≤ selected 30 / 45 / 60 / 90 / 120 min window\n        ↓\nAUTO ETO uses current route geometry + current smoothed live GS to the REF FIX\n```\n\n- The takeoff anchor is the first tracked airborne sample after a confirmed on-ground sample.\n- The application does **not** treat FPL `departureTime` as actual takeoff time.\n- Tracker `actualDepartureTime` is not used as the primary wheels-off source because observed track history can differ from that value.\n- Once a tracked takeoff is found, it is cached so the full track history does not need to be fetched on every refresh.\n- Before takeoff, the panel shows that the domestic flight is waiting for tracked wheels-off.\n- If domestic EET / takeoff enrichment is unavailable, the existing live-route calculation remains available as a fallback once usable live data exists.\n\n## 16. Passed REF FIX back-estimation\n"""
if old_readme not in readme:
    raise SystemExit('README AUTO ETO marker not found')
readme = readme.replace(old_readme, new_readme, 1)
readme_path.write_text(readme, encoding='utf-8')

print('Domestic EET client + README patch applied')
