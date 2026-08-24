import type { IvaoArrivalTrafficFlight, IvaoTrafficPayload } from './core/api'

type RecoveryPhase = 'LIVE' | 'GHOST' | 'RECONNECTED' | 'POSITION_JUMP'

type SharedRecoveryFlight = IvaoArrivalTrafficFlight & {
  rawSessionId?: string | null
  connectionPhase?: RecoveryPhase | 'EXPIRED'
  disconnectedAt?: string | null
  reconnectAt?: string | null
  jumpNm?: number | null
  expectedNm?: number | null
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

const RECOVERY_EVENT = 'aman:reconnect-recovery'
const statuses = new Map<string, RecoveryStatus>()
let installed = false

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

function millis(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function statusKey(airport: string, callsign: string) {
  return `${airport}:${callsign}`
}

function updateStatuses(airport: string, flights: SharedRecoveryFlight[]) {
  for (const key of [...statuses.keys()]) {
    if (key.startsWith(`${airport}:`)) statuses.delete(key)
  }

  for (const flight of flights) {
    const callsign = String(flight.callsign || '').trim().toUpperCase()
    const phase = String(flight.connectionPhase || 'LIVE').trim().toUpperCase()
    if (!callsign || !['LIVE', 'GHOST', 'RECONNECTED', 'POSITION_JUMP'].includes(phase)) continue
    statuses.set(statusKey(airport, callsign), {
      airport,
      callsign,
      phase: phase as RecoveryPhase,
      disconnectedAt: millis(flight.disconnectedAt),
      reconnectAt: millis(flight.reconnectAt),
      jumpNm: finite(flight.jumpNm),
      expectedNm: finite(flight.expectedNm),
    })
  }

  window.dispatchEvent(new CustomEvent(RECOVERY_EVENT, { detail: [...statuses.values()] }))
}

/**
 * The tracker endpoint now performs reconnect recovery against shared Supabase state.
 * This fetch observer only mirrors the returned connection metadata into the HMI; it
 * no longer owns canonical identity or a browser-local 30-minute ghost cache.
 */
export function installReconnectTrafficFetch() {
  if (installed) return
  installed = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const airport = trafficAirport(requestUrl(input))
    const response = await originalFetch(input, init)
    if (!airport || !response.ok) return response

    void response.clone().json()
      .then((payload: IvaoTrafficPayload<SharedRecoveryFlight>) => {
        updateStatuses(airport, Array.isArray(payload.flights) ? payload.flights : [])
      })
      .catch(() => {})

    return response
  }) as typeof window.fetch
}

function recoveryMap() {
  return new Map(statuses)
}

function phaseLabel(status: RecoveryStatus, nowMs: number) {
  if (status.phase === 'GHOST' && status.disconnectedAt != null) {
    const minutes = Math.max(0, Math.floor((nowMs - status.disconnectedAt) / 60_000))
    return `LINK LOST ${minutes}m / 30m`
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
    const status = airport && callsign ? byKey.get(statusKey(airport, callsign)) : undefined

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
    const status = airport && callsign ? byKey.get(statusKey(airport, callsign)) : undefined
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
    const ghostLabel = document.createElement('dt')
    ghostLabel.textContent = 'Ghost reserve'
    const ghostValue = document.createElement('dd')
    ghostValue.textContent = '0'
    ghostRow.append(ghostLabel, ghostValue)
    list.appendChild(ghostRow)
  }
  let reconnectRow = list.querySelector<HTMLElement>('.aman-runtime-reconnect-status')
  if (!reconnectRow) {
    reconnectRow = document.createElement('div')
    reconnectRow.className = 'aman-runtime-reconnect-status'
    const reconnectLabel = document.createElement('dt')
    reconnectLabel.textContent = 'Reconnect'
    const reconnectValue = document.createElement('dd')
    reconnectValue.textContent = 'NONE'
    reconnectRow.append(reconnectLabel, reconnectValue)
    list.appendChild(reconnectRow)
  }

  const values = [...byKey.values()]
  const ghostCount = values.filter((status) => status.phase === 'GHOST').length
  const jumpCount = values.filter((status) => status.phase === 'POSITION_JUMP').length
  const reconnectedCount = values.filter((status) => status.phase === 'RECONNECTED').length
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
