import fs from 'node:fs'

const tsxPath = 'src/IvaoTrafficPanel.tsx'
const cssPath = 'src/ivaoTraffic.css'
let text = fs.readFileSync(tsxPath, 'utf8')
let css = fs.readFileSync(cssPath, 'utf8')

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`Start marker not found: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  if (end < 0) throw new Error(`End marker not found: ${endMarker}`)
  return source.slice(0, start) + replacement + source.slice(end)
}

const typeNeedle = `  reason: string | null\n}`
if (!text.includes(typeNeedle)) throw new Error('AutoEstimate type marker not found')
text = text.replace(typeNeedle, `  reason: string | null\n  pastCrossing?: boolean\n  crossingAgeMin?: number | null\n}`)

const routeHelpers = `function fixDistancesAlongRoute(geometry: RouteGeometry, fix: string) {
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

`
text = replaceBetween(text, 'function fixDistanceAlongRoute(', 'function autoEstimate(', routeHelpers)

const estimateFunctions = `function autoEstimate(
  flight: TrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  groundSpeed: number | null,
  baseTimeIso: string,
  lookaheadMin: number,
): AutoEstimate {
  if (!refFix) return { status: 'unavailable', refFix: null, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'No REF FIX' }
  if (!flight.route || !flight.departure) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Filed route unavailable' }
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
  const minutesToDestination = remainingToDestinationNm / groundSpeed * 60
  const baseTime = new Date(baseTimeIso).getTime()
  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now()

  const targetDistance = fixDistanceAlongRoute(geometry, refFix, progress.progressNm)
  if (targetDistance != null) {
    const remainingNm = Math.max(0, targetDistance - progress.progressNm) + progress.offRouteNm
    const minutesToFix = remainingNm / groundSpeed * 60
    const eto = formatUtcHhmm(safeBaseTime + minutesToFix * 60_000)

    if (minutesToDestination > lookaheadMin) {
      return { status: 'waiting', refFix, eto, remainingNm, minutes: minutesToDestination, groundSpeed, offRouteNm: progress.offRouteNm, reason: `Outside ${lookaheadMin} min ETA window` }
    }
    return { status: 'ready', refFix, eto, remainingNm, minutes: minutesToDestination, groundSpeed, offRouteNm: progress.offRouteNm, reason: null }
  }

  const routeFixDistances = fixDistancesAlongRoute(geometry, refFix)
  if (!routeFixDistances.length) {
    return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: minutesToDestination, groundSpeed, offRouteNm: progress.offRouteNm, reason: 'REF FIX not in filed route' }
  }

  const passedDistance = passedFixDistanceAlongRoute(geometry, refFix, progress.progressNm)
  if (passedDistance == null) {
    return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: minutesToDestination, groundSpeed, offRouteNm: progress.offRouteNm, reason: 'REF FIX not ahead in resolved route' }
  }

  const distanceSinceFix = Math.max(0, progress.progressNm - passedDistance) + progress.offRouteNm
  const crossingAgeMin = distanceSinceFix / groundSpeed * 60
  const eto = formatUtcHhmm(safeBaseTime - crossingAgeMin * 60_000)

  if (minutesToDestination > lookaheadMin) {
    return {
      status: 'waiting', refFix, eto, remainingNm: distanceSinceFix, minutes: minutesToDestination,
      groundSpeed, offRouteNm: progress.offRouteNm, reason: `REF FIX already passed; outside ${lookaheadMin} min ETA window`,
      pastCrossing: true, crossingAgeMin,
    }
  }

  return {
    status: 'ready', refFix, eto, remainingNm: distanceSinceFix, minutes: minutesToDestination,
    groundSpeed, offRouteNm: progress.offRouteNm, reason: 'Estimated past REF FIX crossing',
    pastCrossing: true, crossingAgeMin,
  }
}

function estimateText(estimate: AutoEstimate | undefined, manual: boolean, lookaheadMin: number) {
  if (!estimate) return 'AUTO ETO · waiting for route data'
  if (manual) {
    if (estimate.status === 'ready') {
      return estimate.pastCrossing
        ? `MANUAL ETO · estimated past crossing ${estimate.refFix} ${estimate.eto}Z available`
        : `MANUAL ETO · auto estimate ${estimate.eto}Z available`
    }
    return 'MANUAL ETO · automatic estimate not applied'
  }
  if (estimate.status === 'ready') {
    if (estimate.pastCrossing) {
      return `AUTO ETO · ${estimate.refFix} ~${estimate.eto}Z · EST PAST XING · ~${Math.round(estimate.remainingNm || 0)} NM / ${Math.max(1, Math.round(estimate.crossingAgeMin || 0))} min ago · GS ${Math.round(estimate.groundSpeed || 0)}`
    }
    return `AUTO ETO · ${estimate.refFix} ${estimate.eto}Z · ${Math.round(estimate.remainingNm || 0)} NM · GS ${Math.round(estimate.groundSpeed || 0)}`
  }
  if (estimate.status === 'waiting') {
    if (estimate.pastCrossing) {
      return `AUTO ETO waiting · ${estimate.refFix} already passed ~${Math.max(1, Math.round(estimate.crossingAgeMin || 0))} min ago · ETA >${lookaheadMin} min`
    }
    return `AUTO ETO waiting · ~${Math.ceil(estimate.minutes || 0)} min to destination · auto-fill starts ETA ≤${lookaheadMin} min`
  }
  if (estimate.status === 'calculating') return `AUTO ETO · ${estimate.reason || 'calculating'}`
  return `AUTO ETO unavailable · ${estimate.reason || 'insufficient data'}`
}

`
text = replaceBetween(text, 'function autoEstimate(', 'export default function IvaoTrafficPanel', estimateFunctions)

const classOld = `className={\`ivao-auto-eto \${draft.etoManual ? 'is-manual' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}\`}`
const classNew = `className={\`ivao-auto-eto \${draft.etoManual ? 'is-manual' : estimate?.pastCrossing && estimate?.status === 'ready' ? 'is-past' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}\`}`
if (!text.includes(classOld)) throw new Error('AUTO ETO class marker not found')
text = text.replace(classOld, classNew)

const cssNeedle = `.ivao-auto-eto.is-ready { background: #eaf8ef; color: #167647; }\n`
if (!css.includes(cssNeedle)) throw new Error('AUTO ETO ready CSS marker not found')
css = css.replace(cssNeedle, cssNeedle + `.ivao-auto-eto.is-past { background: #fff3e3; color: #995d0d; }\n`)

fs.writeFileSync(tsxPath, text)
fs.writeFileSync(cssPath, css)
