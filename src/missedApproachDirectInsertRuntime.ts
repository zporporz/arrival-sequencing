type AirportCode = 'VTBD' | 'VTBS'

type ActiveIdentity = {
  airport: AirportCode
  callsign: string
  runway: string
}

type LandedIdentity = ActiveIdentity & {
  landedAt: string
  sessionId: string
}

type LiveFlight = {
  sessionId?: string | null
  callsign?: string | null
  state?: string | null
  onGround?: boolean | null
  trackTimestamp?: string | null
  altitude?: number | null
  verticalSpeedFpm?: number | null
  latitude?: number | null
  longitude?: number | null
}

type TrafficPayload = { flights?: LiveFlight[] }

const DIRECT_INSERT_OFFSET_MS = 10 * 60_000
const LANDED_GA_MAX_AGE_MS = 3 * 60_000
const LIVE_TRACK_MAX_AGE_MS = 90_000
const LANDED_GA_MAX_DISTANCE_NM = 15
const LANDED_GA_MIN_CLIMB_FPM = 200
const AIRPORT_REFERENCE: Record<AirportCode, { lat: number; lon: number }> = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.6811, lon: 100.7473 },
}
const AIRPORT_RUNWAYS: Record<AirportCode, ReadonlySet<string>> = {
  VTBD: new Set(['21R', '21L']),
  VTBS: new Set(['19', '20L', '20R']),
}

function showMessage(text: string) {
  let toast = document.querySelector<HTMLElement>('.aman-runtime-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'aman-runtime-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = text
  toast.classList.add('is-visible')
  window.setTimeout(() => toast?.classList.remove('is-visible'), 2200)
}

function formatHm(ms: number) {
  const date = new Date(ms)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
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

async function postAman(body: Record<string, unknown>) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ serviceDate: new Date().toISOString().slice(0, 10), ...body }),
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || `AMAN API returned ${response.status}`)
}

async function dismissLanded(airport: AirportCode, callsign: string) {
  const response = await fetch('/api/sequence/landed-history', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'dismissLanded', airport, callsign }),
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Landed history API returned ${response.status}`)
}

function activeMenuIdentity(menu: HTMLElement): ActiveIdentity | null {
  const callsign = menu.querySelector('header strong')?.textContent?.trim().toUpperCase() || ''
  const meta = menu.querySelector('header span')?.textContent?.trim().toUpperCase() || ''
  const airport = meta.match(/\b(VTBD|VTBS)\b/)?.[1] as AirportCode | undefined
  const runway = meta.match(/\bRWY\s+([0-9A-Z]+)/)?.[1] || null
  return airport && callsign && runway ? { airport, callsign, runway } : null
}

function landedMenuIdentity(menu: HTMLElement) {
  const callsign = menu.querySelector('header strong')?.textContent?.trim().toUpperCase() || ''
  const meta = menu.querySelector('header span')?.textContent?.trim().toUpperCase() || ''
  const airport = meta.match(/\b(VTBD|VTBS)\b/)?.[1] as AirportCode | undefined
  if (!airport || !callsign) return null

  const row = Array.from(document.querySelectorAll<HTMLElement>('.aman-landed-history-row')).find((candidate) => {
    const rowCallsign = candidate.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    return rowCallsign === callsign && candidate.dataset.landedAirport === airport
  })
  if (!row || row.dataset.landedSource === 'TEST_TRAFFIC') return null
  const runway = row?.querySelector('em')?.textContent?.trim().toUpperCase() || null
  const landedAt = row.dataset.landedAt || ''
  const sessionId = row.dataset.landedSessionId || ''
  return runway && AIRPORT_RUNWAYS[airport].has(runway) && landedAt && sessionId
    ? { airport, callsign, runway, landedAt, sessionId }
    : null
}

function landedMenuIsTest(menu: HTMLElement) {
  const callsign = menu.querySelector('header strong')?.textContent?.trim().toUpperCase() || ''
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-landed-history-row')).some((row) =>
    row.dataset.landedSource === 'TEST_TRAFFIC'
      && row.querySelector('strong')?.textContent?.trim().toUpperCase() === callsign,
  )
}

async function verifyActiveLandedGoAround(identity: LandedIdentity) {
  const landedMs = new Date(identity.landedAt).getTime()
  const landedAgeMs = Date.now() - landedMs
  if (!Number.isFinite(landedMs) || landedAgeMs < -30_000 || landedAgeMs > LANDED_GA_MAX_AGE_MS) {
    throw new Error(`${identity.callsign}: landed record is too old to confirm an active GA`)
  }

  const response = await fetch(`/api/sequence/ivao-traffic?airport=${identity.airport}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  const payload = await response.json().catch(() => ({})) as TrafficPayload & { error?: string }
  if (!response.ok) throw new Error(payload.error || `IVAO traffic returned ${response.status}`)

  const flight = (payload.flights || []).find((item) =>
    String(item.callsign || '').trim().toUpperCase() === identity.callsign,
  )
  if (!flight) throw new Error(`${identity.callsign}: no active IVAO flight; landed state retained`)
  if (!flight.sessionId || String(flight.sessionId) !== identity.sessionId) {
    throw new Error(`${identity.callsign}: IVAO session changed; landed state retained`)
  }
  if (flight.onGround !== false) {
    throw new Error(`${identity.callsign}: aircraft is not confirmed airborne`)
  }

  const trackMs = new Date(flight.trackTimestamp || '').getTime()
  if (!Number.isFinite(trackMs) || Math.abs(Date.now() - trackMs) > LIVE_TRACK_MAX_AGE_MS) {
    throw new Error(`${identity.callsign}: live track is missing or stale`)
  }

  const latitude = Number(flight.latitude)
  const longitude = Number(flight.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`${identity.callsign}: live position is unavailable`)
  }
  const reference = AIRPORT_REFERENCE[identity.airport]
  if (distanceNm(reference.lat, reference.lon, latitude, longitude) > LANDED_GA_MAX_DISTANCE_NM) {
    throw new Error(`${identity.callsign}: aircraft is too far from the airport for landed-stage GA recovery`)
  }

  const state = String(flight.state || '').trim().toLowerCase()
  const verticalSpeedFpm = Number(flight.verticalSpeedFpm)
  const climbing = ['initial climb', 'en route', 'departing'].includes(state)
    || (Number.isFinite(verticalSpeedFpm) && verticalSpeedFpm >= LANDED_GA_MIN_CLIMB_FPM)
  if (!climbing) {
    throw new Error(`${identity.callsign}: no live climb evidence; landed state retained`)
  }
}

async function directInsert(identity: ActiveIdentity, fromLanded: boolean) {
  const { airport, callsign, runway } = identity
  if (fromLanded) await verifyActiveLandedGoAround(identity as LandedIdentity)
  const targetMs = Date.now() + DIRECT_INSERT_OFFSET_MS
  await postAman({
    action: 'setMissedApproachTarget',
    airport,
    callsign,
    manualTldt: new Date(targetMs).toISOString(),
    manualRunway: runway,
  })
  if (fromLanded) await dismissLanded(airport, callsign)
  showMessage(`${callsign}: GA/MISSED inserted ${formatHm(targetMs)}Z (+10M)`)

  // Shared-state/traffic poll will materialize the row. Prompt an immediate refresh of
  // the shared state without reloading the whole page.
  window.dispatchEvent(new CustomEvent('aman:force-shared-refresh'))
}

export function installMissedApproachDirectInsertRuntime() {
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('.aman-runtime-ops-menu button')
    if (!button) return
    const label = (button.textContent || '').trim().toUpperCase()

    const landedMenu = button.closest<HTMLElement>('.aman-landed-stage-menu')
    const isLandedGa = Boolean(landedMenu && label.startsWith('GO AROUND / MISSED'))
    const isActiveMissed = !landedMenu && label === 'MISSED APPROACH'
    if (!isLandedGa && !isActiveMissed) return

    // TEST TRAFFIC owns its local synthetic GA path in landedHistoryRuntime.
    if (landedMenu && landedMenuIsTest(landedMenu)) return

    const identity = landedMenu ? landedMenuIdentity(landedMenu) : activeMenuIdentity(button.closest<HTMLElement>('.aman-runtime-ops-menu')!)
    if (!identity) {
      if (landedMenu) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        showMessage('GA recovery blocked: live session or assigned runway is unavailable')
      }
      return
    }

    // Own this action completely. Do not let the legacy handler first move the flight
    // into MISSED queue; direct-insert is now the single operational flow.
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    button.disabled = true

    void directInsert(identity, Boolean(landedMenu))
      .then(() => button.closest('.aman-runtime-ops-menu')?.remove())
      .catch((error) => {
        button.disabled = false
        showMessage(error instanceof Error ? error.message : String(error))
      })
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
