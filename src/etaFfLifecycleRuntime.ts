type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const REFRESH_MS = 250
const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_TLDT_MINUTES = 4

// ETA-FF/ETO locking is intentionally preserved. TLDT is never hard-locked by lifecycle
// status: controllers may move it at any stage and the normal sequencing cascade remains
// authoritative for downstream separation, including SUPERSTABLE/FROZEN followers.
const lockedEtaFfByKey = new Map<string, number>()
const frozenStatusByKey = new Set<string>()
const frozenTargetRequestAtByKey = new Map<string, number>()
let immediateRefreshQueued = false

const FROZEN_TARGET_RETRY_MS = 5_000

function parseClock(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] || 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return { hours, minutes, seconds }
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

function formatHm(valueMs: number) {
  const date = new Date(valueMs)
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
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

function rowKey(row: HTMLElement) {
  const airport = rowAirport(row)
  const callsign = rowCallsign(row)
  return airport && callsign ? `${airport}:${callsign}` : ''
}

function titleTime(row: HTMLElement, pattern: RegExp, now: Date) {
  const title = row.getAttribute('title') || ''
  const value = title.match(pattern)?.[1]
  return value ? parseHmNearNow(value, now) : null
}

function liveEtaFfMs(row: HTMLElement, now: Date) {
  return titleTime(row, /ETA-FF\s+(\d{2}:\d{2}(?::\d{2})?)Z/i, now)
}

function targetTtoMs(row: HTMLElement, now: Date) {
  return titleTime(row, /STA-FF\/TTO\s+(\d{2}:\d{2}(?::\d{2})?)Z/i, now)
}

function targetTldtMs(row: HTMLElement, now: Date) {
  return titleTime(row, /STA\/TLDT\s+(\d{2}:\d{2}(?::\d{2})?)Z/i, now)
}

function isManualTarget(row: HTMLElement) {
  return row.classList.contains('is-stable')
    || row.dataset.targetMode === 'MANUAL'
    || row.querySelector('.runway-assignment.is-manual') != null
}

function etaCell(row: HTMLElement) {
  const children = row.children
  return children.length > 4 ? children.item(4) as HTMLElement | null : null
}

function displayedEtaFfMs(row: HTMLElement, now: Date) {
  const value = etaCell(row)?.textContent?.trim() || ''
  return value ? parseHmNearNow(value, now) : null
}

function applyStatusClass(element: HTMLElement, status: AmanFlightStatus) {
  const className = `status-${status.toLowerCase()}`
  element.classList.remove('status-unstable', 'status-stable', 'status-superstable', 'status-frozen')
  element.classList.add(className)
  element.dataset.flightStatus = status
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const title = row.getAttribute('title') || ''
  return title.match(/RWY\s+([A-Z0-9]+)/i)?.[1]?.toUpperCase() || ''
}

function requestFrozenTarget(row: HTMLElement, key: string, nowMs: number) {
  if (row.dataset.frozenTldt) return
  const previousRequestAt = frozenTargetRequestAtByKey.get(key)
  if (previousRequestAt != null && nowMs - previousRequestAt < FROZEN_TARGET_RETRY_MS) return

  const approachCategory = String(row.dataset.performanceCategory || '').trim().toUpperCase()
  const distanceNm = Number(row.dataset.finalAlongNm)
  const trackAtMs = new Date(row.dataset.finalTrackAt || '').getTime()
  const airport = rowAirport(row)
  const callsign = rowCallsign(row)
  const runway = rowRunway(row)
  if (!['A', 'B', 'C', 'D', 'E', 'H'].includes(approachCategory)
    || !Number.isFinite(distanceNm)
    || distanceNm < 0
    || distanceNm > 10
    || !Number.isFinite(trackAtMs)
    || !airport
    || !callsign
    || !runway) return

  frozenTargetRequestAtByKey.set(key, nowMs)
  window.dispatchEvent(new CustomEvent('aman:frozen-target-request', {
    detail: {
      airport,
      callsign,
      runway,
      approachCategory,
      distanceNm,
      trackAt: new Date(trackAtMs).toISOString(),
    },
  }))
}

export function resolveFrozenTrigger(input: {
  finalTenNm: boolean
  finalGeometryAvailable: boolean
  targetLandingMs: number | null
  nowMs: number
}) {
  if (input.finalTenNm) return '10NM_FINAL' as const
  if (!input.finalGeometryAvailable
    && input.targetLandingMs != null
    && (input.targetLandingMs - input.nowMs) / 60_000 <= FROZEN_BEFORE_TLDT_MINUTES) {
    return 'TLDT_4MIN_FALLBACK' as const
  }
  return null
}

function statusFromCurrentTarget(row: HTMLElement, now: Date, key: string): AmanFlightStatus {
  if (frozenStatusByKey.has(key)) return 'FROZEN'

  const finalTenNm = row.dataset.finalTenNm === 'true'
  const finalGeometryAvailable = row.dataset.finalGeometryAvailable === 'true'
  const targetLanding = targetTldtMs(row, now)
  const frozenTrigger = resolveFrozenTrigger({
    finalTenNm,
    finalGeometryAvailable,
    targetLandingMs: targetLanding,
    nowMs: now.getTime(),
  })

  if (frozenTrigger) {
    frozenStatusByKey.add(key)
    row.dataset.frozenTrigger = frozenTrigger
    return 'FROZEN'
  }

  if (isManualTarget(row)) {
    const targetIawp = targetTtoMs(row, now)
    if (targetIawp != null && (targetIawp - now.getTime()) / 60_000 <= SUPERSTABLE_BEFORE_IAWP_MINUTES) {
      return 'SUPERSTABLE'
    }
    return 'STABLE'
  }

  // Once STABLE has captured ETA-FF, use that fixed time for all later lifecycle
  // transitions. A changed live ETA must neither move the time nor demote the status.
  const lifecycleEta = lockedEtaFfByKey.get(key) ?? liveEtaFfMs(row, now)
  if (lifecycleEta != null) {
    const minutesToIawp = (lifecycleEta - now.getTime()) / 60_000
    if (minutesToIawp <= SUPERSTABLE_BEFORE_IAWP_MINUTES) return 'SUPERSTABLE'
    if (minutesToIawp <= STABLE_BEFORE_IAWP_MINUTES) return 'STABLE'
    return 'UNSTABLE'
  }

  const current = String(row.dataset.flightStatus || '').trim().toUpperCase()
  if (current === 'STABLE' || current === 'SUPERSTABLE') return current
  return 'UNSTABLE'
}

function resolveDisplayedEta(row: HTMLElement, now: Date, status: AmanFlightStatus, key: string) {
  const liveEta = liveEtaFfMs(row, now)

  // UNSTABLE is the only live ETA stage. Entering STABLE (automatically by time or
  // immediately through controller takeover) hard-locks ETA-FF; SUPERSTABLE and
  // FROZEN retain that same captured value.
  if (status === 'UNSTABLE') {
    lockedEtaFfByKey.delete(key)
  } else if (!lockedEtaFfByKey.has(key)) {
    const entryEta = liveEta ?? displayedEtaFfMs(row, now)
    if (entryEta != null) lockedEtaFfByKey.set(key, entryEta)
  }

  const locked = lockedEtaFfByKey.get(key)
  const display = locked ?? liveEta
  if (display == null) return null

  return { display, locked: locked != null, liveEta }
}

function refreshRows() {
  const now = new Date()
  const activeKeys = new Set<string>()
  const statusByCallsign = new Map<string, AmanFlightStatus>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const key = rowKey(row)
    if (!key) return
    activeKeys.add(key)

    const status = statusFromCurrentTarget(row, now, key)
    applyStatusClass(row, status)

    delete row.dataset.superstableTldt

    if (status === 'FROZEN' && row.dataset.frozenTrigger === '10NM_FINAL') {
      requestFrozenTarget(row, key, now.getTime())
    }

    const callsign = rowCallsign(row)
    if (callsign) statusByCallsign.set(callsign, status)

    const resolved = resolveDisplayedEta(row, now, status, key)
    if (!resolved) return

    const cell = etaCell(row)
    if (cell) {
      const next = formatHm(resolved.display)
      if (cell.textContent?.trim() !== next) cell.textContent = next
      cell.dataset.etaFf = next
      cell.dataset.etaFfLocked = resolved.locked ? 'true' : 'false'
      cell.dataset.etaFfStatus = status
      cell.setAttribute('aria-label', `ETA-FF ${next} ${status}${resolved.locked ? ' locked' : ' live'}`)
    }

    row.dataset.etaFfDisplay = formatHm(resolved.display)
    row.dataset.etaFfLocked = resolved.locked ? 'true' : 'false'
    row.dataset.etaFfLive = resolved.liveEta == null ? '' : formatHm(resolved.liveEta)
  })

  document.querySelectorAll<HTMLElement>('.aman-inbound-row').forEach((row) => {
    const callsign = row.querySelector<HTMLElement>('strong')?.textContent?.trim().toUpperCase() || ''
    const target = row.querySelector<HTMLElement>('strong')
    const status = statusByCallsign.get(callsign)
    if (target && status) applyStatusClass(target, status)
  })

  for (const key of lockedEtaFfByKey.keys()) {
    if (!activeKeys.has(key)) lockedEtaFfByKey.delete(key)
  }
  for (const key of frozenStatusByKey) {
    if (!activeKeys.has(key)) {
      frozenStatusByKey.delete(key)
      frozenTargetRequestAtByKey.delete(key)
    }
  }
}

function queueImmediateRefresh() {
  if (immediateRefreshQueued) return
  immediateRefreshQueued = true
  queueMicrotask(() => {
    immediateRefreshQueued = false
    refreshRows()
  })
}

function mutationTouchesFlightRow(mutation: MutationRecord) {
  const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
  return element?.closest('.aman-flight-row') != null
}

export function installEtaFfLifecycleRuntime() {
  refreshRows()
  const timer = window.setInterval(refreshRows, REFRESH_MS)

  // React can rewrite the timeline time cell while TLDT is being dragged. Restore an
  // already-locked ETA-FF/ETO in the same browser turn, before the next paint, instead
  // of waiting up to 250 ms for the lifecycle timer. This removes the visible
  // move-then-snap-back flicker without changing any lock-stage logic.
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesFlightRow)) queueImmediateRefresh()
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true })

  return () => {
    window.clearInterval(timer)
    observer.disconnect()
    immediateRefreshQueued = false
    lockedEtaFfByKey.clear()
    frozenStatusByKey.clear()
    frozenTargetRequestAtByKey.clear()
  }
}
