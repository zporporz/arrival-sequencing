type LiveFlight = {
  callsign: string
  latitude: number | null
  longitude: number | null
  heading: number | null
  onGround: boolean | null
  trackTimestamp: string | null
}

type TrafficPayload = {
  airport: string
  flights?: LiveFlight[]
}

type RunwayGeometry = {
  lat: number
  lon: number
  course: number
}

const FETCH_MS = 15_000
const APPLY_MS = 1_000
const FINAL_ALONG_TRACK_NM = 10
const FINAL_CROSS_TRACK_NM = 1.5
const FINAL_HEADING_TOLERANCE_DEG = 35
const TRACK_MAX_AGE_MS = 90_000

function dms(deg: number, min: number, sec: number) {
  return deg + min / 60 + sec / 3600
}

// CAAT eAIP runway threshold coordinates / true bearings.
const RUNWAYS: Record<string, RunwayGeometry> = {
  'VTBD:21R': { lat: dms(13, 55, 34.87), lon: dms(100, 36, 44.62), course: 209 },
  'VTBD:21L': { lat: dms(13, 55, 28.33), lon: dms(100, 36, 55.97), course: 208 },
  'VTBS:19': { lat: dms(13, 41, 30.17), lon: dms(100, 45, 39.72), course: 194.42 },
  'VTBS:20L': { lat: dms(13, 42, 13.21), lon: dms(100, 44, 35.44), course: 194.42 },
  'VTBS:20R': { lat: dms(13, 42, 0.68), lon: dms(100, 44, 18.41), course: 194.0 },
}

// Every airport represented by runway geometry is refreshed independently.
// Adding another airport's runways automatically adds its own traffic health scope.
const AIRPORTS = [...new Set(Object.keys(RUNWAYS).map((key) => key.split(':')[0]).filter(Boolean))]

const latestFlights = new Map<string, LiveFlight>()
const airportAvailability = new Map<string, boolean>()

function toRad(value: number) {
  return value * Math.PI / 180
}

function toDeg(value: number) {
  return value * 180 / Math.PI
}

function angularDifference(a: number, b: number) {
  return ((a - b + 540) % 360) - 180
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusNm = 3440.065
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const lambda = toRad(lon2 - lon1)
  const y = Math.sin(lambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function rowAirport(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  if (title.includes('VTBS RWY')) return 'VTBS'
  if (title.includes('VTBD RWY')) return 'VTBD'
  return ''
}

function rowCallsign(row: HTMLElement) {
  return row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || ''
}

function trackFresh(flight: LiveFlight, nowMs = Date.now()) {
  if (!flight.trackTimestamp) return false
  const millis = new Date(flight.trackTimestamp).getTime()
  return Number.isFinite(millis) && Math.abs(nowMs - millis) <= TRACK_MAX_AGE_MS
}

export function evaluateFinalTenNm(airport: string, runway: string, flight: LiveFlight | undefined, nowMs = Date.now()) {
  const geometry = RUNWAYS[`${airport}:${runway}`]
  if (!geometry || !flight || flight.onGround !== false) return { available: false, final: false, along: null, cross: null }
  if (!Number.isFinite(flight.latitude)
    || !Number.isFinite(flight.longitude)
    || !Number.isFinite(flight.heading)
    || !trackFresh(flight, nowMs)) {
    return { available: false, final: false, along: null, cross: null }
  }

  const lat = Number(flight.latitude)
  const lon = Number(flight.longitude)
  const direct = distanceNm(lat, lon, geometry.lat, geometry.lon)
  const bearingToThreshold = initialBearing(lat, lon, geometry.lat, geometry.lon)
  const courseDelta = angularDifference(bearingToThreshold, geometry.course)
  const along = direct * Math.cos(toRad(courseDelta))
  const cross = Math.abs(direct * Math.sin(toRad(courseDelta)))
  const headingOk = Math.abs(angularDifference(Number(flight.heading), geometry.course)) <= FINAL_HEADING_TOLERANCE_DEG

  const final = along >= 0
    && along <= FINAL_ALONG_TRACK_NM
    && cross <= FINAL_CROSS_TRACK_NM
    && headingOk

  return { available: true, final, along, cross }
}

function applyToRows() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    // TEST TRAFFIC has no live positional sensor. Never let a synthetic callsign
    // accidentally match an IVAO flight; its lifecycle uses the four-minute fallback.
    if (row.classList.contains('is-demo')) {
      row.dataset.finalGeometryAvailable = 'false'
      row.dataset.finalTenNm = 'false'
      delete row.dataset.finalAlongNm
      delete row.dataset.finalCrossNm
      delete row.dataset.finalTrackAt
      return
    }

    const airport = rowAirport(row)
    const runway = rowRunway(row)
    const callsign = rowCallsign(row)
    if (!airport || airportAvailability.get(airport) !== true) {
      row.dataset.finalGeometryAvailable = 'false'
      row.dataset.finalTenNm = 'false'
      delete row.dataset.finalAlongNm
      delete row.dataset.finalCrossNm
      delete row.dataset.finalTrackAt
      return
    }
    const flight = latestFlights.get(`${airport}:${callsign}`)
    const result = evaluateFinalTenNm(airport, runway, flight)

    row.dataset.finalGeometryAvailable = result.available ? 'true' : 'false'
    row.dataset.finalTenNm = result.final ? 'true' : 'false'
    if (result.along != null) row.dataset.finalAlongNm = result.along.toFixed(1)
    else delete row.dataset.finalAlongNm
    if (result.cross != null) row.dataset.finalCrossNm = result.cross.toFixed(1)
    else delete row.dataset.finalCrossNm
    if (result.available && flight?.trackTimestamp) row.dataset.finalTrackAt = flight.trackTimestamp
    else delete row.dataset.finalTrackAt
  })
}

function clearAirportFlights(airport: string) {
  for (const [key] of latestFlights) {
    if (key.startsWith(`${airport}:`)) latestFlights.delete(key)
  }
}

async function refreshAirport(airport: string) {
  const response = await fetch(`/api/sequence/ivao-traffic?airport=${encodeURIComponent(airport)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`IVAO traffic ${airport} returned ${response.status}`)
  const payload = await response.json() as TrafficPayload
  clearAirportFlights(airport)
  for (const flight of payload.flights || []) {
    const callsign = String(flight.callsign || '').trim().toUpperCase()
    if (callsign) latestFlights.set(`${airport}:${callsign}`, flight)
  }
}

export function installFinalTenNmRuntime() {
  let disposed = false

  const refresh = async () => {
    await Promise.allSettled(AIRPORTS.map(async (airport) => {
      try {
        await refreshAirport(airport)
        airportAvailability.set(airport, true)
      } catch {
        clearAirportFlights(airport)
        airportAvailability.set(airport, false)
      }
    }))
    if (!disposed) applyToRows()
  }

  void refresh()
  const fetchTimer = window.setInterval(() => void refresh(), FETCH_MS)
  const applyTimer = window.setInterval(applyToRows, APPLY_MS)

  return () => {
    disposed = true
    window.clearInterval(fetchTimer)
    window.clearInterval(applyTimer)
    latestFlights.clear()
    airportAvailability.clear()
  }
}
