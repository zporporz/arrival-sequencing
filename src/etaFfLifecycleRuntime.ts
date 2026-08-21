type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const REFRESH_MS = 250

const lockedEtaFfByKey = new Map<string, number>()
const lastStatusByKey = new Map<string, AmanFlightStatus>()

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
  const previousStatus = lastStatusByKey.get(key)

  if (status === 'UNSTABLE') {
    lockedEtaFfByKey.delete(key)
  } else if (status === 'STABLE') {
    if (!manual) {
      lockedEtaFfByKey.delete(key)
    } else if (!lockedEtaFfByKey.has(key)) {
      // First ATC intervention during STABLE: the displayed ETA-FF becomes the
      // time moved by ATC (the row's current target time over) and stops following
      // the live ETA. The live ETA continues behind the scenes and therefore the
      // delay value can move +/- while this displayed time remains fixed.
      const movedTime = targetTtoMs(row, now) ?? liveEta
      if (movedTime != null) lockedEtaFfByKey.set(key, movedTime)
    }
  } else if (!lockedEtaFfByKey.has(key)) {
    // SUPERSTABLE and FROZEN automatically freeze the displayed ETA-FF even if
    // nobody has manually moved the flight. If this runtime attaches after a
    // manual target already exists, preserve that target time as the visible lock.
    const frozenTime = manual
      ? targetTtoMs(row, now) ?? liveEta
      : liveEta
    if (frozenTime != null) lockedEtaFfByKey.set(key, frozenTime)
  }

  lastStatusByKey.set(key, status)

  const locked = lockedEtaFfByKey.get(key)
  const display = locked ?? liveEta
  if (display == null) return null

  return {
    key,
    status,
    display,
    locked: locked != null,
    liveEta,
    previousStatus,
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
  for (const key of lastStatusByKey.keys()) {
    if (!activeKeys.has(key)) lastStatusByKey.delete(key)
  }
}

export function installEtaFfLifecycleRuntime() {
  refreshRows()
  const timer = window.setInterval(refreshRows, REFRESH_MS)
  return () => {
    window.clearInterval(timer)
    lockedEtaFfByKey.clear()
    lastStatusByKey.clear()
  }
}
