import { readIvaoTraffic, type IvaoArrivalTrafficFlight } from './core/api'
import { BKK_VOR_COORDINATES } from './core/amanConstants'

export type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_LANDING_MINUTES = 4
const STABLE_DISTANCE_NM = 200
const SUPERSTABLE_DISTANCE_NM = 90
const FINAL_TRIGGER_RADIUS_NM = 10
const FINAL_HEADING_TOLERANCE_DEGREES = 40
const FINAL_BEARING_TOLERANCE_DEGREES = 35
const LIVE_FINAL_REFRESH_MS = 30_000
const PX_PER_MINUTE = 10

const AIRPORT_REFERENCE: Record<'VTBD' | 'VTBS', { lat: number; lon: number }> = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.6811, lon: 100.7473 },
}

const RUNWAY_FINAL_HEADING: Record<string, number> = {
  'VTBD:21R': 210,
  'VTBD:21L': 210,
  'VTBS:19': 190,
  'VTBS:20L': 200,
  'VTBS:20R': 200,
}

type LiveFinalInfo = {
  airport: 'VTBD' | 'VTBS'
  callsign: string
  distanceNm: number
  bkkDistanceNm: number
  bearingToAirport: number
  state: string
  heading: number | null
  onGround: boolean | null
}

const liveFinalByKey = new Map<string, LiveFinalInfo>()

function parseClock(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] || 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return { hours, minutes, seconds }
}

function forwardMinutes(fromHm: string, toHm: string) {
  const from = parseClock(fromHm)
  const to = parseClock(toHm)
  if (!from || !to) return null

  const fromSeconds = from.hours * 3600 + from.minutes * 60 + from.seconds
  const toSeconds = to.hours * 3600 + to.minutes * 60 + to.seconds
  const diffSeconds = (toSeconds - fromSeconds + 24 * 3600) % (24 * 3600)
  const diffMinutes = diffSeconds / 60
  return diffMinutes <= 180 ? diffMinutes : null
}

function parseHmNearNow(value: string, now: Date) {
  const clock = parseClock(value)
  if (!clock) return null
  const candidate = new Date(now)
  candidate.setUTCHours(clock.hours, clock.minutes, clock.seconds, 0)
  const delta = candidate.getTime() - now.getTime()
  if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function rowPredictedIawpMs(row: HTMLElement, now: Date) {
  const title = row.getAttribute('title') || ''
  const hm = title.match(/(?:ETA-FF|Predicted IAWP)\s+(\d{2}:\d{2}(?::\d{2})?)Z/i)?.[1]
  return hm ? parseHmNearNow(hm, now) : null
}

function toRadians(value: number) {
  return value * Math.PI / 180
}

function toDegrees(value: number) {
  return value * 180 / Math.PI
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = toRadians(lat1)
  const phi2 = toRadians(lat2)
  const dLon = toRadians(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function headingDifference(left: number, right: number) {
  return Math.abs(((left - right + 540) % 360) - 180)
}

function rowAirport(row: HTMLElement): 'VTBD' | 'VTBS' | null {
  const title = row.getAttribute('title') || ''
  if (title.includes('VTBD RWY')) return 'VTBD'
  if (title.includes('VTBS RWY')) return 'VTBS'
  return null
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  const match = text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)
  return match?.[1] || null
}

function rowCallsign(row: HTMLElement) {
  return row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
}

function liveInfoForRow(row: HTMLElement) {
  const airport = rowAirport(row)
  const callsign = rowCallsign(row)
  if (!airport || !callsign) return null
  return liveFinalByKey.get(`${airport}:${callsign}`) || null
}

function isLiveTenNmFinal(row: HTMLElement) {
  const airport = rowAirport(row)
  const runway = rowRunway(row)
  const info = liveInfoForRow(row)
  if (!airport || !runway || !info || info.onGround === true || info.distanceNm > FINAL_TRIGGER_RADIUS_NM) return false

  const expectedHeading = RUNWAY_FINAL_HEADING[`${airport}:${runway}`]
  if (!Number.isFinite(expectedHeading)) return false

  const stateLooksApproach = info.state === 'approach' || info.state === 'final'
  const headingLooksFinal = info.heading != null
    && headingDifference(info.heading, expectedHeading) <= FINAL_HEADING_TOLERANCE_DEGREES
  const bearingLooksFinal = headingDifference(info.bearingToAirport, expectedHeading) <= FINAL_BEARING_TOLERANCE_DEGREES

  const final = bearingLooksFinal && (stateLooksApproach || headingLooksFinal)
  row.dataset.finalDistanceNm = info.distanceNm.toFixed(1)
  row.dataset.finalTenNm = final ? 'true' : 'false'
  return final
}

function distanceFallbackStatus(row: HTMLElement): AmanFlightStatus | null {
  const info = liveInfoForRow(row)
  if (!info || info.onGround === true || !Number.isFinite(info.bkkDistanceNm)) return null

  // Source table lists these as approximate BKK VOR distance bands (based on 480 kt).
  // Use them only when the ETA/IAWP timing metadata is unavailable; timing remains the
  // primary lifecycle trigger so slower/faster aircraft are not forced into a wrong band.
  if (info.bkkDistanceNm <= SUPERSTABLE_DISTANCE_NM) return 'SUPERSTABLE'
  if (info.bkkDistanceNm <= STABLE_DISTANCE_NM) return 'STABLE'
  return 'UNSTABLE'
}

function rowFlightStatus(row: HTMLElement, now: Date): AmanFlightStatus {
  const cells = row.children
  const tldtHm = cells.item(0)?.textContent?.trim() || ''
  const ttoHm = cells.item(4)?.textContent?.trim() || ''
  const nominalMinutes = forwardMinutes(ttoHm, tldtHm)

  // MAESTRO source: Frozen = 4 minutes before landing, or approximately 10 NM final.
  // The live 10 NM detector is an independent positional trigger.
  if (isLiveTenNmFinal(row)) return 'FROZEN'

  // MAESTRO source timing thresholds:
  // Stable      = 15 min before IAWP / Feeder Fix
  // Superstable =  5 min before IAWP / Feeder Fix
  // Frozen      =  4 min before predicted landing
  // Use ETA-FF (natural prediction), never the manually dragged target, for lifecycle.
  const directPredictedIawpMs = rowPredictedIawpMs(row, now)
  if (directPredictedIawpMs != null && nominalMinutes != null) {
    const predictedLandingMs = directPredictedIawpMs + nominalMinutes * 60_000
    const minutesToIawp = (directPredictedIawpMs - now.getTime()) / 60_000
    const minutesToLanding = (predictedLandingMs - now.getTime()) / 60_000

    if (minutesToLanding <= FROZEN_BEFORE_LANDING_MINUTES) return 'FROZEN'
    if (minutesToIawp <= SUPERSTABLE_BEFORE_IAWP_MINUTES) return 'SUPERSTABLE'
    if (minutesToIawp <= STABLE_BEFORE_IAWP_MINUTES) return 'STABLE'
    return 'UNSTABLE'
  }

  // Source-backed approximate distance bands are a fallback only.
  const distanceStatus = distanceFallbackStatus(row)
  if (distanceStatus) return distanceStatus

  // Last-resort fallback for a row that has neither usable ETA-FF metadata nor live
  // BKK-distance data. Reconstruct the natural prediction from target + displayed delay.
  const delayText = cells.item(5)?.textContent?.trim() || ''
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  const delayMinutes = Number.parseFloat(delayText)
  if (!Number.isFinite(offsetPx) || !Number.isFinite(delayMinutes) || nominalMinutes == null) return 'UNSTABLE'

  const targetTldtMs = now.getTime() - (offsetPx / PX_PER_MINUTE) * 60_000
  const targetTtoMs = targetTldtMs - nominalMinutes * 60_000
  const predictedIawpMs = targetTtoMs - delayMinutes * 60_000
  const predictedLandingMs = predictedIawpMs + nominalMinutes * 60_000
  const minutesToIawp = (predictedIawpMs - now.getTime()) / 60_000
  const minutesToLanding = (predictedLandingMs - now.getTime()) / 60_000

  if (minutesToLanding <= FROZEN_BEFORE_LANDING_MINUTES) return 'FROZEN'
  if (minutesToIawp <= SUPERSTABLE_BEFORE_IAWP_MINUTES) return 'SUPERSTABLE'
  if (minutesToIawp <= STABLE_BEFORE_IAWP_MINUTES) return 'STABLE'
  return 'UNSTABLE'
}

function applyStatusClass(element: HTMLElement, status: AmanFlightStatus) {
  const className = `status-${status.toLowerCase()}`
  if (element.dataset.flightStatus === status) return

  element.classList.remove(
    'status-unstable',
    'status-stable',
    'status-superstable',
    'status-frozen',
  )
  element.classList.add(className)
  element.dataset.flightStatus = status
}

function updateManualLabels() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row, .aman-inbound-row').forEach((element) => {
    const title = element.getAttribute('title')
    if (!title) return
    const next = title
      .replaceAll('ATC manual / Stable', 'ATC MANUAL TARGET')
      .replaceAll('ATC MANUAL / STABLE', 'ATC MANUAL TARGET')
    if (next !== title) element.setAttribute('title', next)
  })

  document.querySelectorAll<HTMLElement>('.aman-status-list dt').forEach((label) => {
    if (label.textContent?.trim() === 'Manual stable') label.textContent = 'Manual target'
  })
}

function refreshFlightStatuses() {
  const now = new Date()
  const byCallsign = new Map<string, AmanFlightStatus>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const status = rowFlightStatus(row, now)
    applyStatusClass(row, status)

    const callsign = row.querySelector('strong')?.textContent?.trim()
    if (callsign) byCallsign.set(callsign, status)
  })

  document.querySelectorAll<HTMLElement>('.aman-inbound-row').forEach((row) => {
    const callsignElement = row.querySelector<HTMLElement>('strong')
    if (!callsignElement) return
    const callsign = callsignElement.textContent?.trim() || ''
    const status = byCallsign.get(callsign) || 'UNSTABLE'
    applyStatusClass(callsignElement, status)
  })

  updateManualLabels()
}

function cleanLiveFlight(airport: 'VTBD' | 'VTBS', flight: IvaoArrivalTrafficFlight) {
  if (!flight.callsign || !Number.isFinite(flight.latitude) || !Number.isFinite(flight.longitude)) return null
  const reference = AIRPORT_REFERENCE[airport]
  const latitude = flight.latitude as number
  const longitude = flight.longitude as number
  return {
    airport,
    callsign: flight.callsign.trim().toUpperCase(),
    distanceNm: distanceNm(reference.lat, reference.lon, latitude, longitude),
    bkkDistanceNm: distanceNm(BKK_VOR_COORDINATES.lat, BKK_VOR_COORDINATES.lon, latitude, longitude),
    bearingToAirport: bearingDegrees(latitude, longitude, reference.lat, reference.lon),
    state: String(flight.state || '').trim().toLowerCase(),
    heading: Number.isFinite(flight.heading) ? Number(flight.heading) : null,
    onGround: flight.onGround,
  } satisfies LiveFinalInfo
}

async function refreshLiveFinalData() {
  try {
    const results = await Promise.all((['VTBD', 'VTBS'] as const).map(async (airport) => {
      try {
        const payload = await readIvaoTraffic(airport)
        return (payload.flights ?? [])
          .map((flight) => cleanLiveFlight(airport, flight))
          .filter((flight): flight is LiveFinalInfo => flight !== null)
      } catch {
        return []
      }
    }))

    liveFinalByKey.clear()
    for (const flight of results.flat()) {
      liveFinalByKey.set(`${flight.airport}:${flight.callsign}`, flight)
    }
    refreshFlightStatuses()
  } catch {
    // Time-based lifecycle remains available when live final data fails.
  }
}

function updateInteractionHint() {
  const hint = document.querySelector<HTMLElement>('.is-drag-enabled')
  if (hint) hint.textContent = 'DRAG = SET TARGET · DBL CLICK = RETURN TO AUTO · RIGHT CLICK = OPS'
}

export function installFlightStatusRuntime() {
  updateInteractionHint()
  refreshFlightStatuses()
  void refreshLiveFinalData()

  const statusTimer = window.setInterval(() => {
    updateInteractionHint()
    refreshFlightStatuses()
  }, 1_000)
  const liveFinalTimer = window.setInterval(() => void refreshLiveFinalData(), LIVE_FINAL_REFRESH_MS)

  return () => {
    window.clearInterval(statusTimer)
    window.clearInterval(liveFinalTimer)
  }
}
