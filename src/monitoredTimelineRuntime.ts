import {
  VTBD_IAWP_NOMINAL_MINUTES,
  VTBS_STAR19_NOMINAL_MINUTES,
} from './core/amanConstants'
import { TIMELINE_DISPLAY_PX_PER_MINUTE } from './timelineScale'

type AirportCode = 'VTBD' | 'VTBS'
type DisplaySide = 'LEFT' | 'RIGHT'

type MonitoredFlight = {
  key: string
  airport: AirportCode
  callsign: string
  aircraft: string
  refFix: string
  etaFfMs: number
  projectedLandingMs: number
}

const FUTURE_HORIZON_MS = 4 * 60 * 60 * 1000
const STORAGE_KEY = 'aman-airport-display-sides-v1'
const REFRESH_MS = 500

function readDisplaySides() {
  const fallback: Record<AirportCode, DisplaySide> = { VTBD: 'LEFT', VTBS: 'RIGHT' }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Record<AirportCode, DisplaySide>>
    return {
      VTBD: parsed.VTBD === 'RIGHT' ? 'RIGHT' : 'LEFT',
      VTBS: parsed.VTBS === 'LEFT' ? 'LEFT' : 'RIGHT',
    } satisfies Record<AirportCode, DisplaySide>
  } catch {
    return fallback
  }
}

function parseHmNearNow(value: string, nowMs: number) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/)
  if (!match) return null
  const now = new Date(nowMs)
  const candidate = new Date(nowMs)
  candidate.setUTCHours(Number(match[1]), Number(match[2]), 0, 0)
  if (candidate.getTime() < nowMs - 30 * 60_000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (candidate.getTime() > nowMs + 23.5 * 60 * 60_000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function formatHm(valueMs: number) {
  const date = new Date(valueMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function nominalStarMinutes(airport: AirportCode, fix: string) {
  const normalized = fix.trim().toUpperCase()
  if (airport === 'VTBD') {
    const value = (VTBD_IAWP_NOMINAL_MINUTES as Record<string, number>)[normalized]
    return Number.isFinite(value) ? value : null
  }
  const value = (VTBS_STAR19_NOMINAL_MINUTES as Record<string, number>)[normalized]
  return Number.isFinite(value) ? value : null
}

function compactFix(airport: AirportCode, fix: string) {
  const normalized = fix.trim().toUpperCase()
  if (airport === 'VTBD') {
    if (normalized === 'SEHNA') return 's'
    return normalized.slice(0, 1)
  }
  return normalized.slice(0, 1)
}

function monitoredFlights(nowMs: number) {
  const flights: MonitoredFlight[] = []

  document.querySelectorAll<HTMLElement>('.aman-inbound-row[data-planning-state="MONITORED"]').forEach((row) => {
    const airportText = row.querySelector<HTMLElement>('.apt')?.textContent?.trim().toUpperCase()
    const airport: AirportCode | null = airportText === 'BD' ? 'VTBD' : airportText === 'BS' ? 'VTBS' : null
    if (!airport) return

    const callsign = row.querySelector<HTMLElement>('.aman-inbound-acid strong')?.textContent?.trim().toUpperCase() || ''
    const cells = Array.from(row.children)
    const aircraft = cells[2]?.textContent?.trim().toUpperCase() || '----'
    const refFix = cells[3]?.textContent?.trim().toUpperCase() || '----'
    const etaText = cells[4]?.textContent?.trim() || ''
    if (!callsign || !refFix || refFix === '----') return

    const etaFfMs = parseHmNearNow(etaText, nowMs)
    const starMinutes = nominalStarMinutes(airport, refFix)
    if (etaFfMs == null || starMinutes == null) return

    const projectedLandingMs = etaFfMs + starMinutes * 60_000
    const delta = projectedLandingMs - nowMs
    if (delta < 0 || delta > FUTURE_HORIZON_MS) return

    flights.push({
      key: `${airport}:${callsign}`,
      airport,
      callsign,
      aircraft,
      refFix,
      etaFfMs,
      projectedLandingMs,
    })
  })

  return flights
}

function buildRow(flight: MonitoredFlight, side: DisplaySide, nowMs: number) {
  const row = document.createElement('div')
  row.className = 'aman-monitored-flight-row'
  row.dataset.monitorKey = flight.key
  row.dataset.displaySide = side

  const offsetMinutes = (flight.projectedLandingMs - nowMs) / 60_000
  row.style.setProperty('--monitor-offset-px', `${Math.round(-offsetMinutes * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
  row.title = `MONITORED / PROVISIONAL · ${flight.airport} · ${flight.callsign} · ETA-FF ${formatHm(flight.etaFfMs)}Z · projected landing ${formatHm(flight.projectedLandingMs)}Z · activates for sequencing at 300 NM`

  const projected = document.createElement('span')
  projected.className = 'tldt'
  projected.textContent = formatHm(flight.projectedLandingMs)

  const callsign = document.createElement('strong')
  callsign.textContent = flight.callsign

  const aircraft = document.createElement('span')
  aircraft.textContent = flight.aircraft

  const fix = document.createElement('span')
  fix.className = `fix-code${flight.airport === 'VTBD' && flight.refFix === 'SEHNA' ? ' is-underlined' : ''}`
  fix.textContent = compactFix(flight.airport, flight.refFix)

  const eta = document.createElement('span')
  eta.textContent = formatHm(flight.etaFfMs)

  const state = document.createElement('b')
  state.textContent = 'MON'

  const runway = document.createElement('em')
  runway.textContent = '—'

  row.append(projected, callsign, aircraft, fix, eta, state, runway)
  return row
}

export function installMonitoredTimelineRuntime() {
  let disposed = false

  const decorate = () => {
    if (disposed) return
    const layer = document.querySelector<HTMLElement>('.aman-flight-layer')
    if (!layer) return

    const nowMs = Date.now()
    const sides = readDisplaySides()
    const flights = monitoredFlights(nowMs)
    const liveKeys = new Set(flights.map((flight) => flight.key))

    layer.querySelectorAll<HTMLElement>('.aman-monitored-flight-row').forEach((row) => {
      const key = row.dataset.monitorKey || ''
      if (!liveKeys.has(key)) row.remove()
    })

    for (const flight of flights) {
      let row = layer.querySelector<HTMLElement>(`.aman-monitored-flight-row[data-monitor-key="${CSS.escape(flight.key)}"]`)
      if (!row) {
        row = buildRow(flight, sides[flight.airport], nowMs)
        layer.appendChild(row)
      }

      row.dataset.displaySide = sides[flight.airport]
      const offsetMinutes = (flight.projectedLandingMs - nowMs) / 60_000
      row.style.setProperty('--monitor-offset-px', `${Math.round(-offsetMinutes * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
      row.title = `MONITORED / PROVISIONAL · ${flight.airport} · ${flight.callsign} · ETA-FF ${formatHm(flight.etaFfMs)}Z · projected landing ${formatHm(flight.projectedLandingMs)}Z · activates for sequencing at 300 NM`
      const projected = row.querySelector<HTMLElement>('.tldt')
      const eta = row.children.item(4) as HTMLElement | null
      if (projected) projected.textContent = formatHm(flight.projectedLandingMs)
      if (eta) eta.textContent = formatHm(flight.etaFfMs)
    }
  }

  decorate()
  const timer = window.setInterval(decorate, REFRESH_MS)
  const observer = new MutationObserver(decorate)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-planning-state'] })

  return () => {
    disposed = true
    window.clearInterval(timer)
    observer.disconnect()
    document.querySelectorAll('.aman-monitored-flight-row').forEach((row) => row.remove())
  }
}
