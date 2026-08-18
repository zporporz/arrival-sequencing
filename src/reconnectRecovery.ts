import type { IvaoArrivalTrafficFlight, IvaoTrafficPayload } from './core/api'

type RecoveryPhase = 'LIVE' | 'GHOST' | 'RECONNECTED' | 'POSITION_JUMP'

type RecoveryRecord = {
  key: string
  airport: string
  callsign: string
  canonicalSessionId: string
  rawSessionId: string
  snapshot: IvaoArrivalTrafficFlight
  lastSeenAt: number
  disconnectedAt: number | null
  phase: RecoveryPhase
  reconnectAt: number | null
  jumpNm: number | null
  expectedNm: number | null
}

export type RecoveryStatus = {
  airport: string
  callsign: string
  phase: RecoveryPhase
  disconnectedAt: number | null
  reconnectAt: number | null
  jumpNm: number | null
  expectedNm: number | null
}

const GHOST_RETENTION_MS = 30 * 60 * 1000
const RECONNECT_NOTICE_MS = 5 * 60 * 1000
const RECOVERY_EVENT = 'aman:reconnect-recovery'
const records = new Map<string, RecoveryRecord>()
let installed = false

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function trafficAirport(urlText: string) {
  try {
    const url = new URL(urlText, window.location.origin)
    if (url.pathname !== '/api/sequence/ivao-traffic') return null
    const airport = (url.searchParams.get('airport') || '').trim().toUpperCase()
    return airport || null
  } catch {
    return null
  }
}

function recordKey(airport: string, flight: IvaoArrivalTrafficFlight) {
  return `${airport}:${String(flight.callsign || '').trim().toUpperCase()}`
}

function sameFlightIdentity(record: RecoveryRecord, flight: IvaoArrivalTrafficFlight) {
  const oldDeparture = String(record.snapshot.departure || '').trim().toUpperCase()
  const newDeparture = String(flight.departure || '').trim().toUpperCase()
  if (oldDeparture && newDeparture && oldDeparture !== newDeparture) return false

  const oldArrival = String(record.snapshot.arrival || '').trim().toUpperCase()
  const newArrival = String(flight.arrival || '').trim().toUpperCase()
  if (oldArrival && newArrival && oldArrival !== newArrival) return false
  return true
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

function snapshotTimeMs(flight: IvaoArrivalTrafficFlight, fallback: number) {
  const trackMs = flight.trackTimestamp ? new Date(flight.trackTimestamp).getTime() : NaN
  return Number.isFinite(trackMs) ? trackMs : fallback
}

function reconnectPlausibility(previous: IvaoArrivalTrafficFlight, current: IvaoArrivalTrafficFlight, fallbackDtMs: number) {
  if (
    !finiteNumber(previous.latitude)
    || !finiteNumber(previous.longitude)
    || !finiteNumber(current.latitude)
    || !finiteNumber(current.longitude)
  ) return { jumpNm: null, expectedNm: null, plausible: true }

  const previousTime = snapshotTimeMs(previous, Date.now() - fallbackDtMs)
  const currentTime = snapshotTimeMs(current, Date.now())
  const dtMs = Math.max(1_000, currentTime > previousTime ? currentTime - previousTime : fallbackDtMs)
  const dtHours = dtMs / 3_600_000
  const jumpNm = distanceNm(previous.latitude, previous.longitude, current.latitude, current.longitude)

  const speeds = [previous.groundSpeed, current.groundSpeed].filter(finiteNumber).filter((value) => value > 30)
  const referenceSpeed = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 450
  const expectedNm = referenceSpeed * dtHours

  // Wide tolerance by design: pilot may pause briefly, speed can change, and IVAO track samples
  // are not continuous. We only flag clearly implausible reconnect jumps.
  const maxPlausibleNm = Math.max(15, expectedNm * 1.8 + 10)
  return { jumpNm, expectedNm, plausible: jumpNm <= maxPlausibleNm }
}

function sequenceRowFor(airport: string, callsign: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((row) => {
    const rowCallsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    const title = row.getAttribute('title') || ''
    return rowCallsign === callsign && title.includes(`${airport} RWY`)
  }) ?? null
}

function shouldRetainGhost(record: RecoveryRecord, nowMs: number) {
  if (record.disconnectedAt == null) return false
  if (nowMs - record.disconnectedAt > GHOST_RETENTION_MS) return false

  // Keep only a slot that is still operationally ahead of ACTUAL. This avoids turning a
  // normal landing/disconnect after touchdown into a 30-minute ghost reservation.
  const row = sequenceRowFor(record.airport, record.callsign)
  if (!row) return false
  return !row.classList.contains('is-past')
}

function statusSnapshot() {
  return [...records.values()].map((record): RecoveryStatus => ({
    airport: record.airport,
    callsign: record.callsign,
    phase: record.phase,
    disconnectedAt: record.disconnectedAt,
    reconnectAt: record.reconnectAt,
    jumpNm: record.jumpNm,
    expectedNm: record.expectedNm,
  }))
}

function emitRecoveryState() {
  window.dispatchEvent(new CustomEvent(RECOVERY_EVENT, { detail: statusSnapshot() }))
}

function recoverPayload(airport: string, payload: IvaoTrafficPayload<IvaoArrivalTrafficFlight>) {
  const fetchedMs = Number.isFinite(new Date(payload.fetchedAt).getTime())
    ? new Date(payload.fetchedAt).getTime()
    : Date.now()
  const liveFlights = Array.isArray(payload.flights) ? payload.flights : []
  const recoveredFlights: IvaoArrivalTrafficFlight[] = []
  const seenKeys = new Set<string>()

  for (const rawFlight of liveFlights) {
    const callsign = String(rawFlight.callsign || '').trim().toUpperCase()
    if (!callsign) continue

    const key = recordKey(airport, rawFlight)
    seenKeys.add(key)
    let record = records.get(key)

    if (record && (!sameFlightIdentity(record, rawFlight) || (record.disconnectedAt != null && fetchedMs - record.disconnectedAt > GHOST_RETENTION_MS))) {
      records.delete(key)
      record = undefined
    }

    if (!record) {
      const canonicalSessionId = String(rawFlight.sessionId || '').trim() || crypto.randomUUID()
      const normalized: IvaoArrivalTrafficFlight = { ...rawFlight, sessionId: canonicalSessionId }
      record = {
        key,
        airport,
        callsign,
        canonicalSessionId,
        rawSessionId: String(rawFlight.sessionId || ''),
        snapshot: normalized,
        lastSeenAt: fetchedMs,
        disconnectedAt: null,
        phase: 'LIVE',
        reconnectAt: null,
        jumpNm: null,
        expectedNm: null,
      }
      records.set(key, record)
      recoveredFlights.push(normalized)
      continue
    }

    const wasDisconnected = record.disconnectedAt != null
    const rawSessionChanged = String(rawFlight.sessionId || '') !== record.rawSessionId
    const fallbackDtMs = Math.max(1_000, fetchedMs - record.lastSeenAt)

    if (wasDisconnected || rawSessionChanged) {
      const plausibility = reconnectPlausibility(record.snapshot, rawFlight, fallbackDtMs)
      record.phase = plausibility.plausible ? 'RECONNECTED' : 'POSITION_JUMP'
      record.reconnectAt = fetchedMs
      record.jumpNm = plausibility.jumpNm
      record.expectedNm = plausibility.expectedNm
    } else if (record.reconnectAt == null || fetchedMs - record.reconnectAt > RECONNECT_NOTICE_MS) {
      record.phase = 'LIVE'
      record.jumpNm = null
      record.expectedNm = null
    }

    record.rawSessionId = String(rawFlight.sessionId || '')
    record.lastSeenAt = fetchedMs
    record.disconnectedAt = null
    record.snapshot = { ...rawFlight, sessionId: record.canonicalSessionId }
    recoveredFlights.push(record.snapshot)
  }

  for (const record of [...records.values()]) {
    if (record.airport !== airport || seenKeys.has(record.key)) continue

    if (record.disconnectedAt == null) {
      record.disconnectedAt = fetchedMs
      record.phase = 'GHOST'
      record.reconnectAt = null
      record.jumpNm = null
      record.expectedNm = null
    }

    if (!shouldRetainGhost(record, fetchedMs)) {
      records.delete(record.key)
      continue
    }

    // Keep the last real track timestamp. arrivalEta therefore freezes the old live-route
    // prediction instead of moving the ghost forward by 30 seconds every poll.
    recoveredFlights.push({
      ...record.snapshot,
      sessionId: record.canonicalSessionId,
      state: 'DISCONNECTED',
      onGround: false,
      heading: null,
    })
  }

  emitRecoveryState()
  return { ...payload, flights: recoveredFlights }
}

export function installReconnectTrafficFetch() {
  if (installed) return
  installed = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const airport = trafficAirport(requestUrl(input))
    const response = await originalFetch(input, init)
    if (!airport || !response.ok) return response

    try {
      const payload = await response.clone().json() as IvaoTrafficPayload<IvaoArrivalTrafficFlight>
      if (!payload || !Array.isArray(payload.flights)) return response
      const recovered = recoverPayload(airport, payload)
      const headers = new Headers(response.headers)
      headers.set('content-type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(recovered), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch {
      return response
    }
  }) as typeof window.fetch
}

function recoveryMap() {
  const map = new Map<string, RecoveryStatus>()
  for (const status of statusSnapshot()) map.set(`${status.airport}:${status.callsign}`, status)
  return map
}

function phaseLabel(status: RecoveryStatus, nowMs: number) {
  if (status.phase === 'GHOST' && status.disconnectedAt != null) {
    const minutes = Math.max(0, Math.floor((nowMs - status.disconnectedAt) / 60_000))
    return `LINK LOST ${minutes}m`
  }
  if (status.phase === 'POSITION_JUMP') {
    return status.jumpNm != null ? `POSITION JUMP ${status.jumpNm.toFixed(0)}NM` : 'POSITION JUMP'
  }
  if (status.phase === 'RECONNECTED') return 'RECONNECTED'
  return ''
}

function decorateRecoveryRows() {
  const byKey = recoveryMap()
  const nowMs = Date.now()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    const title = row.getAttribute('title') || ''
    const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
    const status = airport && callsign ? byKey.get(`${airport}:${callsign}`) : undefined

    if (!status || status.phase === 'LIVE') {
      delete row.dataset.connectionState
      delete row.dataset.linkLabel
      return
    }
    row.dataset.connectionState = status.phase
    row.dataset.linkLabel = phaseLabel(status, nowMs)
  })

  document.querySelectorAll<HTMLElement>('.aman-inbound-row').forEach((row) => {
    const callsignElement = row.querySelector<HTMLElement>('strong')
    const airportText = row.querySelector<HTMLElement>('.apt')?.textContent?.trim().toUpperCase() || ''
    const airport = airportText === 'BS' ? 'VTBS' : airportText === 'BD' ? 'VTBD' : ''
    const callsign = callsignElement?.textContent?.trim().toUpperCase() || ''
    const status = airport && callsign ? byKey.get(`${airport}:${callsign}`) : undefined
    if (!callsignElement || !status || status.phase === 'LIVE') {
      if (callsignElement) {
        delete callsignElement.dataset.connectionState
        delete callsignElement.dataset.linkLabel
      }
      return
    }
    callsignElement.dataset.connectionState = status.phase
    callsignElement.dataset.linkLabel = phaseLabel(status, nowMs)
  })

  const list = document.querySelector<HTMLElement>('.aman-status-list')
  if (!list) return
  let ghostRow = list.querySelector<HTMLElement>('.aman-runtime-ghost-status')
  if (!ghostRow) {
    ghostRow = document.createElement('div')
    ghostRow.className = 'aman-runtime-ghost-status'
    ghostRow.innerHTML = '<dt>Ghost reserve</dt><dd>0</dd>'
    list.appendChild(ghostRow)
  }
  let reconnectRow = list.querySelector<HTMLElement>('.aman-runtime-reconnect-status')
  if (!reconnectRow) {
    reconnectRow = document.createElement('div')
    reconnectRow.className = 'aman-runtime-reconnect-status'
    reconnectRow.innerHTML = '<dt>Reconnect</dt><dd>NONE</dd>'
    list.appendChild(reconnectRow)
  }

  const statuses = [...byKey.values()]
  const ghostCount = statuses.filter((status) => status.phase === 'GHOST').length
  const jumpCount = statuses.filter((status) => status.phase === 'POSITION_JUMP').length
  const reconnectedCount = statuses.filter((status) => status.phase === 'RECONNECTED').length
  const ghostValue = ghostRow.querySelector('dd')
  const reconnectValue = reconnectRow.querySelector('dd')
  if (ghostValue) ghostValue.textContent = String(ghostCount)
  if (reconnectValue) {
    reconnectValue.textContent = jumpCount ? `JUMP ${jumpCount}` : reconnectedCount ? `OK ${reconnectedCount}` : 'NONE'
    reconnectValue.classList.toggle('is-warning', jumpCount > 0)
  }
}

export function installReconnectUiRuntime() {
  const handler = () => decorateRecoveryRows()
  window.addEventListener(RECOVERY_EVENT, handler)
  decorateRecoveryRows()
  const timer = window.setInterval(decorateRecoveryRows, 1_000)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener(RECOVERY_EVENT, handler)
  }
}
