import { readIvaoTraffic, type IvaoArrivalTrafficFlight } from './core/api'
import {
  AMAN_DELAY_THRESHOLDS_MINUTES,
  AMAN_ETA_FF_REFRESH_MS,
  getAmanOperationalMatrixAdvice,
  splitAmanDelay,
} from './core/amanConstants'

type HoldingMode = 'AUTO' | 'HOLD' | 'NO_HOLD'

type SharedFlightState = {
  service_date: string
  airport: string
  callsign: string
  canonical_session_id: string
  holding_mode: HoldingMode
  holding_fix: string | null
  holding_leave_at: string | null
  missed_approach_active?: boolean | null
}

type SharedWorkspaceState = {
  airport: string
  settings: Record<string, unknown>
}

type SharedStateDetail = {
  serviceDate: string
  workspaceStates: SharedWorkspaceState[]
  flightStates: SharedFlightState[]
}

type LivePlanningData = {
  airport: string
  callsign: string
  groundSpeed: number | null
  altitude: number | null
}

const SHARED_STATE_EVENT = 'aman:shared-state'
const LIVE_REFRESH_MS = AMAN_ETA_FF_REFRESH_MS
const DEFAULT_HOLDING_THRESHOLD_MINUTES = AMAN_DELAY_THRESHOLDS_MINUTES.HOLDING_MIN
const DEFAULT_DEMO_GS_KT = 420
const MIN_SPEED_PLAN_KT = 140
const MAX_SPEED_PLAN_KT = 520

const VTBD_FIX_BY_CODE: Record<string, string> = {
  E: 'ENDUU',
  N: 'NAKON',
  S: 'SABAI',
  s: 'SEHNA',
  W: 'WEHHA',
}

const VTBS_FIX_BY_CODE: Record<string, string> = {
  E: 'EASTE',
  T: 'TUMGA',
  L: 'LEBIM',
  N: 'NORTA',
  W: 'WILLA',
}

function flightKey(airport: string, callsign: string) {
  return `${airport}:${callsign}`
}

function selectedAirports() {
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.aman-airport-scope-picker input[type="checkbox"]:checked'))
    .map((input) => input.value.trim().toUpperCase())
    .filter((airport) => airport === 'VTBD' || airport === 'VTBS')
  if (checked.length) return checked

  const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.aman-airport-tabs > button'))
    .find((button) => button.classList.contains('is-active'))
    ?.textContent?.trim().toUpperCase()
  return active === 'BOTH' ? ['VTBD', 'VTBS'] : active === 'VTBS' ? ['VTBS'] : ['VTBD']
}

function rowIdentity(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  return airport && callsign ? { airport, callsign, key: flightKey(airport, callsign) } : null
}

function rowFullFix(row: HTMLElement, airport: string) {
  const code = row.querySelector<HTMLElement>('.fix-code')?.textContent?.trim() || ''
  return airport === 'VTBS' ? VTBS_FIX_BY_CODE[code.toUpperCase()] || code : VTBD_FIX_BY_CODE[code] || code
}

function parseHmNearNow(value: string, preferFuture = true) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const now = new Date()
  const candidate = new Date(now)
  candidate.setUTCHours(Number(match[1]), Number(match[2]), 0, 0)
  let delta = candidate.getTime() - now.getTime()
  if (preferFuture && delta < -3 * 60 * 60 * 1000) {
    candidate.setUTCDate(candidate.getUTCDate() + 1)
    delta = candidate.getTime() - now.getTime()
  }
  if (!preferFuture && delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function formatHm(value: number | string | null) {
  const date = typeof value === 'number' ? new Date(value) : new Date(value || '')
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function formatOne(value: number) {
  const rounded = Math.round(value * 10) / 10
  return rounded.toFixed(rounded % 1 === 0 ? 0 : 1)
}

function rowPredictedIawpMs(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const hm = title.match(/(?:ETA-FF|Predicted IAWP)\s+(\d{2}:\d{2})Z/i)?.[1]
  return hm ? parseHmNearNow(hm, true) : null
}

function rowTtoMs(row: HTMLElement) {
  const hm = row.children.item(4)?.textContent?.trim() || ''
  return parseHmNearNow(hm, true)
}

function rowDelayMinutes(row: HTMLElement) {
  const value = Number.parseFloat(row.children.item(5)?.textContent?.trim() || '')
  return Number.isFinite(value) ? value : 0
}

function currentRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || ''
}

function planningSpeedKt(row: HTMLElement, live: LivePlanningData | undefined) {
  const predictedMs = rowPredictedIawpMs(row)
  const targetMs = rowTtoMs(row)
  const nowMs = Date.now()
  const predictedMinutes = predictedMs == null ? NaN : (predictedMs - nowMs) / 60_000
  const targetMinutes = targetMs == null ? NaN : (targetMs - nowMs) / 60_000
  const currentGs = live?.groundSpeed && live.groundSpeed > 80
    ? live.groundSpeed
    : row.classList.contains('is-demo') ? DEFAULT_DEMO_GS_KT : null

  if (currentGs == null || !Number.isFinite(predictedMinutes) || !Number.isFinite(targetMinutes)) return null
  if (predictedMinutes <= 1 || targetMinutes <= 1) return null

  const raw = currentGs * predictedMinutes / targetMinutes
  if (!Number.isFinite(raw)) return null
  const rounded = Math.round(Math.min(MAX_SPEED_PLAN_KT, Math.max(MIN_SPEED_PLAN_KT, raw)) / 10) * 10
  return {
    currentGs,
    advisedGs: rounded,
    speedOnlyFeasible: raw >= MIN_SPEED_PLAN_KT && raw <= MAX_SPEED_PLAN_KT,
  }
}

function ensureSystemRow(className: string, label: string) {
  const list = document.querySelector<HTMLElement>('.aman-status-list')
  if (!list) return null
  let row = list.querySelector<HTMLElement>(`.${className}`)
  if (!row) {
    row = document.createElement('div')
    row.className = className
    const term = document.createElement('dt')
    term.textContent = label
    const value = document.createElement('dd')
    value.textContent = '0'
    row.append(term, value)
    list.appendChild(row)
  }
  return row.querySelector<HTMLElement>('dd')
}

async function writeHoldingState(
  airport: string,
  callsign: string,
  holdingMode: HoldingMode,
  holdingFix: string | null,
  holdingLeaveAt: string | null,
) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      action: 'setHolding',
      serviceDate: new Date().toISOString().slice(0, 10),
      airport,
      callsign,
      holdingMode,
      holdingFix,
      holdingLeaveAt,
    }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Holding API returned ${response.status}`)
}

export function installOperationalAdvisoryRuntime() {
  const liveByKey = new Map<string, LivePlanningData>()
  const sharedFlights = new Map<string, SharedFlightState>()
  const workspaceSettings = new Map<string, Record<string, unknown>>()
  let disposed = false

  const refreshTraffic = async () => {
    const airports = selectedAirports()
    const results = await Promise.all(airports.map(async (airport) => {
      try {
        const payload = await readIvaoTraffic(airport)
        return (payload.flights ?? []).map((flight: IvaoArrivalTrafficFlight): LivePlanningData => ({
          airport,
          callsign: flight.callsign.trim().toUpperCase(),
          groundSpeed: Number.isFinite(flight.groundSpeed) ? Number(flight.groundSpeed) : null,
          altitude: Number.isFinite(flight.altitude) ? Number(flight.altitude) : null,
        }))
      } catch {
        return []
      }
    }))

    if (disposed) return
    for (const airport of airports) {
      for (const key of [...liveByKey.keys()]) {
        if (key.startsWith(`${airport}:`)) liveByKey.delete(key)
      }
    }
    for (const flight of results.flat()) liveByKey.set(flightKey(flight.airport, flight.callsign), flight)
  }

  const decorate = () => {
    let holdingCount = 0
    let speedCount = 0
    let overloadCount = 0

    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      const identity = rowIdentity(row)
      const delayCell = row.children.item(5) as HTMLElement | null
      if (!identity || !delayCell) return

      const state = sharedFlights.get(identity.key)
      const settings = workspaceSettings.get(identity.airport) || {}
      const thresholdValue = Number(settings.holdingThresholdMinutes)
      const holdingThreshold = Number.isFinite(thresholdValue) && thresholdValue >= DEFAULT_HOLDING_THRESHOLD_MINUTES
        ? thresholdValue
        : DEFAULT_HOLDING_THRESHOLD_MINUTES
      const delayMinutes = rowDelayMinutes(row)
      const split = splitAmanDelay(delayMinutes)
      const matrix = getAmanOperationalMatrixAdvice(delayMinutes)
      const autoHolding = row.classList.contains('action-holding') || delayMinutes >= holdingThreshold
      const holdingMode = state?.holding_mode || 'AUTO'
      const missedApproachActive = state?.missed_approach_active === true
        || row.dataset.missedApproachActive === 'true'
      // A missed approach is a reinserted arrival, not a holding instruction.
      // GA must take precedence even when its NOW+10 target creates a large TDLY.
      const holdingActive = !missedApproachActive
        && (holdingMode === 'HOLD' || (holdingMode === 'AUTO' && autoHolding))
      const fullFix = state?.holding_fix || rowFullFix(row, identity.airport)
      const ttoMs = rowTtoMs(row)
      const leaveAtMs = state?.holding_leave_at ? new Date(state.holding_leave_at).getTime() : ttoMs
      const live = liveByKey.get(identity.key)
      const speed = planningSpeedKt(row, live)
      const speedAction = row.classList.contains('action-speed_reduction') || row.classList.contains('action-expedite')

      delete delayCell.dataset.advisory
      delete delayCell.dataset.advisoryKind
      delete row.dataset.holdingActive
      row.dataset.holdingMode = holdingMode
      row.dataset.tdly = formatOne(split.tdlyMinutes)
      row.dataset.edly = formatOne(split.edlyMinutes)
      row.dataset.adly = formatOne(split.adlyMinutes)
      row.dataset.operationalBand = matrix.band
      delayCell.dataset.delaySplit = `E${formatOne(split.edlyMinutes)} A${formatOne(split.adlyMinutes)}`
      delayCell.dataset.matrixAction = matrix.shortLabel

      if (matrix.band === 'OVERLOAD') overloadCount += 1

      if (missedApproachActive) {
        delayCell.dataset.advisory = 'GO AROUND'
        delayCell.dataset.advisoryKind = 'ga'
      } else if (holdingActive) {
        holdingCount += 1
        row.dataset.holdingActive = 'true'
        delayCell.dataset.advisory = `LEAVE ${formatHm(Number.isFinite(leaveAtMs) ? leaveAtMs : null)}`
        delayCell.dataset.advisoryKind = 'holding'
      } else if (speedAction && speed) {
        speedCount += 1
        delayCell.dataset.advisory = speed.speedOnlyFeasible ? `GS~${speed.advisedGs}` : 'SPD+PATH'
        delayCell.dataset.advisoryKind = row.classList.contains('action-expedite') ? 'expedite' : 'speed'
      } else if (delayMinutes >= 6) {
        delayCell.dataset.advisory = matrix.shortLabel
        delayCell.dataset.advisoryKind = matrix.band === 'CONSIDER_HOLD' ? 'holding' : 'speed'
      } else if (delayMinutes > 0) {
        delayCell.dataset.advisory = `E${formatOne(split.edlyMinutes)} A${formatOne(split.adlyMinutes)}`
        delayCell.dataset.advisoryKind = 'speed'
      }

      const titleBase = (row.getAttribute('title') || '')
        .replace(/ · MAESTRO SPLIT .*$/i, '')
        .replace(/ · HOLD at .*$/i, '')
        .replace(/ · planning GS advisory .*$/i, '')
        .replace(/ · speed alone is insufficient.*$/i, '')
      const splitText = `MAESTRO SPLIT TDLY ${formatOne(split.tdlyMinutes)} · EDLY ${formatOne(split.edlyMinutes)} · ADLY ${formatOne(split.adlyMinutes)} · ${matrix.primary}${matrix.secondary ? ` / ${matrix.secondary}` : ''}${matrix.vectorLimit !== '—' ? ` · vector ${matrix.vectorLimit}` : ''}`
      let title = `${titleBase} · ${splitText}`

      if (holdingActive) {
        title += ` · HOLD at ${fullFix || 'STAR ENTRY'} · leave ${formatHm(Number.isFinite(leaveAtMs) ? leaveAtMs : null)}Z`
      } else if (speedAction && speed) {
        title += speed.speedOnlyFeasible
          ? ` · planning GS advisory ~${speed.advisedGs} kt from current ${Math.round(speed.currentGs)} kt`
          : ' · speed alone is insufficient; path action required'
      }
      row.setAttribute('title', title)

      delayCell.title = `TDLY ${formatOne(split.tdlyMinutes)} · EDLY ${formatOne(split.edlyMinutes)} · ADLY ${formatOne(split.adlyMinutes)} · ${matrix.primary}${matrix.secondary ? ` / ${matrix.secondary}` : ''}. Double-click this number to toggle HOLD/AUTO override.`
      row.dataset.assignedRunway = currentRunway(row)
    })

    const hldCounter = Array.from(document.querySelectorAll<HTMLElement>('.aman-counters > div')).find((item) =>
      item.querySelector('span')?.textContent?.trim().toUpperCase() === 'HLD')
    const hldValue = hldCounter?.querySelector('strong')
    if (hldValue) hldValue.textContent = String(holdingCount).padStart(3, '0')
    hldCounter?.classList.toggle('has-holding', holdingCount > 0)

    const holdingSystem = ensureSystemRow('aman-runtime-holding-status', 'Holding / STA-FF')
    const speedSystem = ensureSystemRow('aman-runtime-speed-status', 'Speed advisory')
    const splitSystem = ensureSystemRow('aman-runtime-delay-split-status', 'Delay split')
    const overloadSystem = ensureSystemRow('aman-runtime-overload-status', 'MAESTRO matrix')
    if (holdingSystem) holdingSystem.textContent = holdingCount ? `${holdingCount} ACTIVE` : 'NONE'
    if (speedSystem) speedSystem.textContent = speedCount ? `${speedCount} ACTIVE` : 'NONE'
    if (splitSystem) splitSystem.textContent = 'TDLY / EDLY / ADLY'
    if (overloadSystem) overloadSystem.textContent = overloadCount ? `${overloadCount} OVERLOAD` : 'NORMAL'
  }

  const onSharedState = (event: Event) => {
    const detail = (event as CustomEvent<SharedStateDetail>).detail
    if (!detail) return
    sharedFlights.clear()
    workspaceSettings.clear()
    for (const state of detail.flightStates || []) {
      sharedFlights.set(flightKey(state.airport, state.callsign), state)
    }
    for (const state of detail.workspaceStates || []) {
      workspaceSettings.set(state.airport, state.settings || {})
    }
    decorate()
  }

  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const delayCell = target.closest<HTMLElement>('.aman-flight-row > b')
    const row = delayCell?.closest<HTMLElement>('.aman-flight-row')
    if (!delayCell || !row) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const identity = rowIdentity(row)
    if (!identity) return
    const state = sharedFlights.get(identity.key)
    const currentMode = state?.holding_mode || 'AUTO'
    const autoHolding = row.classList.contains('action-holding') || rowDelayMinutes(row) >= DEFAULT_HOLDING_THRESHOLD_MINUTES
    const nextMode: HoldingMode = currentMode === 'AUTO'
      ? autoHolding ? 'NO_HOLD' : 'HOLD'
      : 'AUTO'
    const fix = rowFullFix(row, identity.airport) || null
    const ttoMs = rowTtoMs(row)
    const leaveAt = ttoMs == null ? null : new Date(ttoMs).toISOString()

    const optimistic: SharedFlightState = {
      service_date: new Date().toISOString().slice(0, 10),
      airport: identity.airport,
      callsign: identity.callsign,
      canonical_session_id: state?.canonical_session_id || '',
      holding_mode: nextMode,
      holding_fix: nextMode === 'NO_HOLD' ? null : fix,
      holding_leave_at: nextMode === 'NO_HOLD' ? null : leaveAt,
    }
    sharedFlights.set(identity.key, optimistic)
    decorate()
    void writeHoldingState(identity.airport, identity.callsign, nextMode, optimistic.holding_fix, optimistic.holding_leave_at)
      .catch((error) => {
        delayCell.title = error instanceof Error ? error.message : String(error)
      })
  }

  window.addEventListener(SHARED_STATE_EVENT, onSharedState)
  document.addEventListener('dblclick', onDoubleClick, true)
  void refreshTraffic()
  decorate()

  const trafficTimer = window.setInterval(() => void refreshTraffic(), LIVE_REFRESH_MS)
  const decorateTimer = window.setInterval(decorate, 1_000)

  return () => {
    disposed = true
    window.clearInterval(trafficTimer)
    window.clearInterval(decorateTimer)
    window.removeEventListener(SHARED_STATE_EVENT, onSharedState)
    document.removeEventListener('dblclick', onDoubleClick, true)
  }
}
