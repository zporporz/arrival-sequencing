import { TIMELINE_LOGICAL_PX_PER_MINUTE } from './timelineScale'

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
const POINTER_ID = 70423
const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_TLDT_MINUTES = 4
const TARGET_TOLERANCE_MS = 2_000
const LOCAL_DRAG_GRACE_MS = 1_200

const lockedEtaFfByKey = new Map<string, number>()
const superstableTldtByKey = new Map<string, number>()
const frozenTldtByKey = new Map<string, number>()
const sharedRevisionByKey = new Map<string, string>()
const localDragUntilByKey = new Map<string, number>()

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
  // FROZEN remains a lifecycle state, but ATC may still move its protected target.
  if (frozenTldtByKey.has(key)) return 'FROZEN'

  const targetLanding = targetTldtMs(row, now)
  const finalTenNm = row.dataset.finalTenNm === 'true'
  if (finalTenNm || (targetLanding != null && (targetLanding - now.getTime()) / 60_000 <= FROZEN_BEFORE_TLDT_MINUTES)) {
    const frozen = targetLanding ?? superstableTldtByKey.get(key)
    if (frozen != null) frozenTldtByKey.set(key, frozen)
    superstableTldtByKey.delete(key)
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
  props.onPointerMove(fakePointer(-deltaMinutes * TIMELINE_LOGICAL_PX_PER_MINUTE))
  props.onPointerUp(fakePointer(-deltaMinutes * TIMELINE_LOGICAL_PX_PER_MINUTE))
  return true
}

function sharedTargetChanged(row: HTMLElement, key: string) {
  const revision = row.dataset.sharedRevision || ''
  if (!revision) return false
  const previous = sharedRevisionByKey.get(key)
  sharedRevisionByKey.set(key, revision)
  return previous != null && previous !== revision
}

function localDragActive(key: string) {
  return (localDragUntilByKey.get(key) ?? 0) >= Date.now()
}

function enforceSuperstableTldt(row: HTMLElement, now: Date, key: string) {
  const current = targetTldtMs(row, now)
  if (current == null) return

  let protectedTarget = superstableTldtByKey.get(key)
  if (protectedTarget == null) {
    protectedTarget = current
    superstableTldtByKey.set(key, current)
  }

  // A local drag or a newer shared revision is an intentional ATC target change.
  if (row.classList.contains('is-dragging') || localDragActive(key) || sharedTargetChanged(row, key)) {
    superstableTldtByKey.set(key, current)
    row.dataset.superstableTldt = new Date(current).toISOString()
    return
  }

  // Automatic calculation/cascade must not walk a SUPERSTABLE target.
  if (!isManualTarget(row) || Math.abs(current - protectedTarget) > TARGET_TOLERANCE_MS) {
    applyTargetThroughReact(row, protectedTarget, now)
  }

  row.dataset.superstableTldt = new Date(protectedTarget).toISOString()
}

function enforceFrozenTldt(row: HTMLElement, now: Date, key: string) {
  const protectedTarget = frozenTldtByKey.get(key)
  const current = targetTldtMs(row, now)
  if (protectedTarget == null || current == null) return

  // FROZEN blocks automatic movement, not the controller. A local drag or a manual
  // target received from another controller replaces the protected TLDT immediately.
  if (row.classList.contains('is-dragging') || localDragActive(key) || sharedTargetChanged(row, key)) {
    frozenTldtByKey.set(key, current)
    row.dataset.frozenTldt = new Date(current).toISOString()
    return
  }

  if (!isManualTarget(row) || Math.abs(current - protectedTarget) > TARGET_TOLERANCE_MS) {
    applyTargetThroughReact(row, protectedTarget, now)
  }

  row.dataset.frozenTldt = new Date(protectedTarget).toISOString()
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

    if (status === 'SUPERSTABLE') {
      enforceSuperstableTldt(row, now, key)
    } else if (status === 'FROZEN') {
      enforceFrozenTldt(row, now, key)
    } else {
      superstableTldtByKey.delete(key)
      delete row.dataset.superstableTldt
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
  for (const key of superstableTldtByKey.keys()) {
    if (!activeKeys.has(key)) superstableTldtByKey.delete(key)
  }
  for (const key of frozenTldtByKey.keys()) {
    if (!activeKeys.has(key)) frozenTldtByKey.delete(key)
  }
  for (const key of sharedRevisionByKey.keys()) {
    if (!activeKeys.has(key)) sharedRevisionByKey.delete(key)
  }
  for (const key of localDragUntilByKey.keys()) {
    if (!activeKeys.has(key) || !localDragActive(key)) localDragUntilByKey.delete(key)
  }
}

function markLocalDrag(event: PointerEvent) {
  if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('select')) return
  const row = event.target.closest<HTMLElement>('.aman-flight-row')
  if (!row) return
  const key = rowKey(row)
  if (key) localDragUntilByKey.set(key, Date.now() + LOCAL_DRAG_GRACE_MS)
}

function finishLocalDrag(event: PointerEvent) {
  if (!(event.target instanceof Element)) return
  const row = event.target.closest<HTMLElement>('.aman-flight-row')
  if (!row) return
  const key = rowKey(row)
  if (key) localDragUntilByKey.set(key, Date.now() + LOCAL_DRAG_GRACE_MS)
}

function blockFrozenNonDragEdit(event: Event) {
  if (!(event.target instanceof Element)) return
  const row = event.target.closest<HTMLElement>('.aman-flight-row')
  if (!row || row.dataset.flightStatus !== 'FROZEN') return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export function installEtaFfLifecycleRuntime() {
  refreshRows()
  const timer = window.setInterval(refreshRows, REFRESH_MS)

  // Every lifecycle stage, including FROZEN, may be dragged by ATC in both LIVE and
  // TEST modes. Only automatic calculation/cascade remains locked out of FROZEN.
  document.addEventListener('pointerdown', markLocalDrag, true)
  document.addEventListener('pointerup', finishLocalDrag, true)
  document.addEventListener('pointercancel', finishLocalDrag, true)

  // Keep the existing FROZEN protection for reset/runway edits; this does not block drag.
  document.addEventListener('dblclick', blockFrozenNonDragEdit, true)
  document.addEventListener('change', blockFrozenNonDragEdit, true)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('pointerdown', markLocalDrag, true)
    document.removeEventListener('pointerup', finishLocalDrag, true)
    document.removeEventListener('pointercancel', finishLocalDrag, true)
    document.removeEventListener('dblclick', blockFrozenNonDragEdit, true)
    document.removeEventListener('change', blockFrozenNonDragEdit, true)
    lockedEtaFfByKey.clear()
    superstableTldtByKey.clear()
    frozenTldtByKey.clear()
    sharedRevisionByKey.clear()
    localDragUntilByKey.clear()
  }
}
