type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

type FakePointerEvent = {
  button: number
  preventDefault: () => void
  currentTarget: {
    setPointerCapture: (pointerId: number) => void
    hasPointerCapture: (pointerId: number) => boolean
    releasePointerCapture: (pointerId: number) => void
  }
  pointerId: number
  clientY: number
}

type ReactRowProps = {
  onPointerDown?: (event: FakePointerEvent) => void
  onPointerMove?: (event: FakePointerEvent) => void
  onPointerUp?: (event: FakePointerEvent) => void
}

const REFRESH_MS = 250
const PX_PER_MINUTE = 10
const POINTER_ID = 70423
const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_TLDT_MINUTES = 4

const lockedEtaFfByKey = new Map<string, number>()
const frozenTldtByKey = new Map<string, number>()

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function fakePointer(clientY: number): FakePointerEvent {
  return {
    button: 0,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    },
    pointerId: POINTER_ID,
    clientY,
  }
}

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

function applyStatusClass(element: HTMLElement, status: AmanFlightStatus) {
  const className = `status-${status.toLowerCase()}`
  element.classList.remove('status-unstable', 'status-stable', 'status-superstable', 'status-frozen')
  element.classList.add(className)
  element.dataset.flightStatus = status
}

function statusFromCurrentTarget(row: HTMLElement, now: Date, key: string): AmanFlightStatus {
  // Once the four-minute gate has been crossed, FROZEN is sticky until the row
  // leaves the live sequence and becomes a landed-history row.
  if (frozenTldtByKey.has(key)) return 'FROZEN'

  const targetLanding = targetTldtMs(row, now)
  const finalTenNm = row.dataset.finalTenNm === 'true'
  if (finalTenNm || (targetLanding != null && (targetLanding - now.getTime()) / 60_000 <= FROZEN_BEFORE_TLDT_MINUTES)) {
    if (targetLanding != null) frozenTldtByKey.set(key, targetLanding)
    return 'FROZEN'
  }

  if (isManualTarget(row)) {
    const targetIawp = targetTtoMs(row, now)
    if (targetIawp != null && (targetIawp - now.getTime()) / 60_000 <= SUPERSTABLE_BEFORE_IAWP_MINUTES) {
      return 'SUPERSTABLE'
    }
    return 'STABLE'
  }

  const liveEta = liveEtaFfMs(row, now)
  if (liveEta != null) {
    const minutesToIawp = (liveEta - now.getTime()) / 60_000
    if (minutesToIawp <= SUPERSTABLE_BEFORE_IAWP_MINUTES) return 'SUPERSTABLE'
    if (minutesToIawp <= STABLE_BEFORE_IAWP_MINUTES) return 'STABLE'
    return 'UNSTABLE'
  }

  const current = String(row.dataset.flightStatus || '').trim().toUpperCase()
  if (current === 'STABLE' || current === 'SUPERSTABLE') return current
  return 'UNSTABLE'
}

function applyTargetThroughReact(row: HTMLElement, targetMs: number, now: Date) {
  const currentMs = targetTldtMs(row, now)
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false

  const deltaMinutes = (targetMs - currentMs) / 60_000
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  props.onPointerUp(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  return true
}

function enforceFrozenTldt(row: HTMLElement, now: Date, key: string) {
  const frozen = frozenTldtByKey.get(key)
  if (frozen == null) return
  const current = targetTldtMs(row, now)
  const manual = isManualTarget(row)

  // Entering FROZEN converts the current TLDT into a protected local target.
  // Re-apply it if a later live ETA refresh or cascade tries to move the row.
  if (!manual || current == null || Math.abs(current - frozen) > 2_000) {
    applyTargetThroughReact(row, frozen, now)
  }

  row.dataset.frozenTldt = new Date(frozen).toISOString()
}

function resolveDisplayedEta(row: HTMLElement, now: Date, status: AmanFlightStatus, key: string) {
  const liveEta = liveEtaFfMs(row, now)
  const manual = isManualTarget(row)
  const targetTto = targetTtoMs(row, now)

  if (status === 'UNSTABLE') {
    lockedEtaFfByKey.delete(key)
  } else if (status === 'STABLE') {
    if (!manual) {
      lockedEtaFfByKey.delete(key)
    } else {
      const movedTime = targetTto ?? liveEta
      if (movedTime != null) lockedEtaFfByKey.set(key, movedTime)
    }
  } else if (status === 'SUPERSTABLE') {
    if (manual) {
      const movedTime = targetTto ?? liveEta
      if (movedTime != null) lockedEtaFfByKey.set(key, movedTime)
    } else if (!lockedEtaFfByKey.has(key) && liveEta != null) {
      lockedEtaFfByKey.set(key, liveEta)
    }
  } else if (!lockedEtaFfByKey.has(key)) {
    const frozenTime = manual ? targetTto ?? liveEta : liveEta
    if (frozenTime != null) lockedEtaFfByKey.set(key, frozenTime)
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
    if (status === 'FROZEN') enforceFrozenTldt(row, now, key)

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
  for (const key of frozenTldtByKey.keys()) {
    if (!activeKeys.has(key)) frozenTldtByKey.delete(key)
  }
}

function blockFrozenDrag(event: PointerEvent) {
  if (event.button !== 0 || !(event.target instanceof Element)) return
  if (event.target.closest('select')) return
  const row = event.target.closest<HTMLElement>('.aman-flight-row')
  if (!row || row.dataset.flightStatus !== 'FROZEN') return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export function installEtaFfLifecycleRuntime() {
  refreshRows()
  const timer = window.setInterval(refreshRows, REFRESH_MS)
  document.addEventListener('pointerdown', blockFrozenDrag, true)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('pointerdown', blockFrozenDrag, true)
    lockedEtaFfByKey.clear()
    frozenTldtByKey.clear()
  }
}
