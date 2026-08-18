import { readIvaoTraffic, type IvaoArrivalTrafficFlight } from './core/api'

export type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_LANDING_MINUTES = 4
const FINAL_TRIGGER_RADIUS_NM = 10
const FINAL_HEADING_TOLERANCE_DEGREES = 40
const LIVE_FINAL_REFRESH_MS = 30_000
const PX_PER_MINUTE = 10

// Approximate aerodrome reference points. The 10 NM trigger is deliberately a
// tactical awareness fallback, not a replacement for the normal 4-min prediction.
const AIRPORT_REFERENCE: Record<'VTBD' | 'VTBS', { lat: number; lon: number }> = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.6811, lon: 100.7473 },
}

// Approximate inbound runway magnetic courses used only to avoid classifying an
// aircraft on downwind/base inside the 10 NM airport radius as FINAL.
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
  state: string
  heading: number | null
  onGround: boolean | null
}

const liveFinalByKey = new Map<string, LiveFinalInfo>()

function forwardMinutes(fromHm: string, toHm: string) {
  const from = fromHm.match(/^(\d{2}):(\d{2})$/)
  const to = toHm.match(/^(\d{2}):(\d{2})$/)
  if (!from || !to) return null

  const fromMinutes = Number(from[1]) * 60 + Number(from[2])
  const toMinutes = Number(to[1]) * 60 + Number(to[2])
  if (!Number.isFinite(fromMinutes) || !Number.isFinite(toMinutes)) return null

  const diff = (toMinutes - fromMinutes + 24 * 60) % (24 * 60)
  return diff <= 180 ? diff : null
}

function toRadians(value: number) {
  return value * Math.PI / 180
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

function isLiveTenNmFinal(row: HTMLElement) {
  const airport = rowAirport(row)
  const callsign = rowCallsign(row)
  const runway = rowRunway(row)
  if (!airport || !callsign || !runway) return false

  const info = liveFinalByKey.get(`${airport}:${callsign}`)
  if (!info || info.onGround === true || info.distanceNm > FINAL_TRIGGER_RADIUS_NM) return false

  const stateLooksApproach = info.state === 'approach' || info.state === 'final'
  const expectedHeading = RUNWAY_FINAL_HEADING[`${airport}:${runway}`]
  const headingLooksFinal = info.heading != null
    && Number.isFinite(expectedHeading)
    && headingDifference(info.heading, expectedHeading) <= FINAL_HEADING_TOLERANCE_DEGREES

  const final = stateLooksApproach || headingLooksFinal
  row.dataset.finalDistanceNm = info.distanceNm.toFixed(1)
  row.dataset.finalTenNm = final ? 'true' : 'false'
  return final
}

function rowFlightStatus(row: HTMLElement, now: Date): AmanFlightStatus {
  const cells = row.children
  const tldtHm = cells.item(0)?.textContent?.trim() || ''
  const ttoHm = cells.item(4)?.textContent?.trim() || ''
  const delayText = cells.item(5)?.textContent?.trim() || ''
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  const delayMinutes = Number.parseFloat(delayText)
  const nominalMinutes = forwardMinutes(ttoHm, tldtHm)

  // Flight lifecycle and controller ownership are intentionally independent.
  // Dragging/assigning a runway marks the target as MANUAL in App, but it does not
  // promote the aircraft to Stable. Likewise RETURN TO AUTO does not force Unstable.
  // The colour/status below is always driven by predicted flight progress.

  // MAESTRO reference: Frozen is 4 minutes before landing / about 10 NM Final.
  // The live-position branch supplements the prediction so a real aircraft on
  // short final is Frozen even when ETA/STAR modelling is slightly off.
  if (isLiveTenNmFinal(row)) return 'FROZEN'

  if (!Number.isFinite(offsetPx) || !Number.isFinite(delayMinutes) || nominalMinutes == null) {
    return 'UNSTABLE'
  }

  // The row is positioned from TLDT with 10 px/minute. Reconstructing TLDT from the
  // timeline position preserves roughly six-second precision, then use displayed
  // Delay Required to recover the current predicted IAWP time. This still works for
  // a manual target because Delay Required keeps updating against the live prediction.
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
  return {
    airport,
    callsign: flight.callsign.trim().toUpperCase(),
    distanceNm: distanceNm(reference.lat, reference.lon, flight.latitude as number, flight.longitude as number),
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
    // The normal time-based status model remains available when live final data fails.
  }
}

function updateInteractionHint() {
  const hint = document.querySelector<HTMLElement>('.is-drag-enabled')
  if (hint) hint.textContent = 'DRAG = SET TARGET · DBL CLICK = RETURN TO AUTO'
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
