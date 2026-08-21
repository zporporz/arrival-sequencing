type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const REFRESH_MS = 250

const lockedEtaFfByKey = new Map<string, number>()

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

function rowStatus(row: HTMLElement): AmanFlightStatus {
  const value = String(row.dataset.flightStatus || '').trim().toUpperCase()
  if (value === 'STABLE' || value === 'SUPERSTABLE' || value === 'FROZEN') return value
  return 'UNSTABLE'
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

function isManualTarget(row: HTMLElement) {
  return row.classList.contains('is-stable')
    || row.dataset.targetMode === 'MANUAL'
    || row.querySelector('.runway-assignment.is-manual') != null
}

function etaCell(row: HTMLElement) {
  const children = row.children
  return children.length > 4 ? children.item(4) as HTMLElement | null : null
}

function resolveDisplayedEta(row: HTMLElement, now: Date) {
  const key = rowKey(row)
  if (!key) return null

  const status = rowStatus(row)
  const liveEta = liveEtaFfMs(row, now)
  const manual = isManualTarget(row)
  const targetTto = targetTtoMs(row, now)

  if (status === 'UNSTABLE') {
    // UNSTABLE always follows the continuously recalculated live ETA-FF.
    lockedEtaFfByKey.delete(key)
  } else if (status === 'STABLE') {
    if (!manual) {
      // STABLE still follows live calculation until ATC intervenes.
      lockedEtaFfByKey.delete(key)
    } else {
      // Once ATC moves a STABLE flight, stop following the live calculation.
      // Every later ATC move is still allowed and replaces the locked displayed time.
      const movedTime = targetTto ?? liveEta
      if (movedTime != null) lockedEtaFfByKey.set(key, movedTime)
    }
  } else if (status === 'SUPERSTABLE') {
    if (manual) {
      // SUPERSTABLE is still draggable. Track every ATC move so the flight can
      // move back out to STABLE when the new time no longer meets the condition.
      const movedTime = targetTto ?? liveEta
      if (movedTime != null) lockedEtaFfByKey.set(key, movedTime)
    } else if (!lockedEtaFfByKey.has(key) && liveEta != null) {
      // With no ATC intervention, entering SUPERSTABLE freezes the visible ETA-FF.
      lockedEtaFfByKey.set(key, liveEta)
    }
  } else if (!lockedEtaFfByKey.has(key)) {
    // FROZEN is the final lock. ATC target movement may still affect TLDT/delay,
    // but the displayed ETA-FF no longer follows either live calculation or drag.
    const frozenTime = manual ? targetTto ?? liveEta : liveEta
    if (frozenTime != null) lockedEtaFfByKey.set(key, frozenTime)
  }

  const locked = lockedEtaFfByKey.get(key)
  const display = locked ?? liveEta
  if (display == null) return null

  return {
    key,
    status,
    display,
    locked: locked != null,
    liveEta,
  }
}

function refreshRows() {
  const now = new Date()
  const activeKeys = new Set<string>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const resolved = resolveDisplayedEta(row, now)
    if (!resolved) return
    activeKeys.add(resolved.key)

    const cell = etaCell(row)
    if (cell) {
      const next = formatHm(resolved.display)
      if (cell.textContent?.trim() !== next) cell.textContent = next
      cell.dataset.etaFf = next
      cell.dataset.etaFfLocked = resolved.locked ? 'true' : 'false'
      cell.dataset.etaFfStatus = resolved.status
      cell.setAttribute('aria-label', `ETA-FF ${next} ${resolved.status}${resolved.locked ? ' locked' : ' live'}`)
    }

    row.dataset.etaFfDisplay = formatHm(resolved.display)
    row.dataset.etaFfLocked = resolved.locked ? 'true' : 'false'
    row.dataset.etaFfLive = resolved.liveEta == null ? '' : formatHm(resolved.liveEta)
  })

  for (const key of lockedEtaFfByKey.keys()) {
    if (!activeKeys.has(key)) lockedEtaFfByKey.delete(key)
  }
}

export function installEtaFfLifecycleRuntime() {
  refreshRows()
  const timer = window.setInterval(refreshRows, REFRESH_MS)
  return () => {
    window.clearInterval(timer)
    lockedEtaFfByKey.clear()
  }
}
