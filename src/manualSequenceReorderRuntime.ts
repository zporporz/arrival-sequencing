import {
  amanSequenceOrderIdentity,
  setAmanManualSequenceOrderSnapshot,
} from './core/arrivalSequencing'
import {
  TIMELINE_DISPLAY_PX_PER_MINUTE,
  TIMELINE_LOGICAL_PX_PER_MINUTE,
} from './timelineScale'

type SharedFlightState = {
  airport: string
  callsign: string
  target_mode?: 'AUTO' | 'MANUAL' | null
  manual_tldt?: string | null
  manual_runway?: string | null
}

type SharedStateDetail = { flightStates?: SharedFlightState[] }

type DragOrderState = {
  pointerId: number
  row: HTMLElement
  identity: string
  airport: string
  runway: string
  startY: number
  startTargetMs: number
  allowReorder: boolean
  moved: boolean
}

const MOVE_TOLERANCE_PX = 3
const groupOrders = new Map<string, string[]>()
let drag: DragOrderState | null = null

function rowIdentity(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  if (!airport || !callsign) return null
  return { airport, callsign, identity: amanSequenceOrderIdentity(airport, callsign) }
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || ''
}

function rowTargetMs(row: HTMLElement) {
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return Date.now() - offsetPx / TIMELINE_LOGICAL_PX_PER_MINUTE * 60_000

  const hm = row.querySelector<HTMLElement>('.tldt')?.textContent?.trim().match(/^(\d{2}):(\d{2})$/)
  if (!hm) return null
  const now = new Date()
  const candidate = new Date(now)
  candidate.setUTCHours(Number(hm[1]), Number(hm[2]), 0, 0)
  const delta = candidate.getTime() - now.getTime()
  if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function groupKey(airport: string, runway: string) { return `${airport}:${runway}` }

function rowsForGroup(airport: string, runway: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).filter((row) => {
    const identity = rowIdentity(row)
    return identity?.airport === airport && rowRunway(row) === runway
  })
}

function publishOrderSnapshot() {
  const snapshot: Record<string, number> = {}
  for (const order of groupOrders.values()) {
    order.forEach((identity, index) => { snapshot[identity] = index + 1 })
  }
  setAmanManualSequenceOrderSnapshot(snapshot)
}

function orderFromTargets(
  airport: string,
  runway: string,
  targetOverrides: ReadonlyMap<string, number> = new Map(),
) {
  return rowsForGroup(airport, runway)
    .map((row, fallbackIndex) => {
      const identity = rowIdentity(row)
      if (!identity) return null
      const target = targetOverrides.get(identity.identity) ?? rowTargetMs(row)
      if (target == null) return null
      return { identity: identity.identity, target, fallbackIndex }
    })
    .filter((item): item is { identity: string; target: number; fallbackIndex: number } => item !== null)
    .sort((a, b) => a.target - b.target || a.fallbackIndex - b.fallbackIndex)
    .map((item) => item.identity)
}

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function currentGroupOrder(airport: string, runway: string) {
  return groupOrders.get(groupKey(airport, runway)) ?? orderFromTargets(airport, runway)
}

function updateDragOrder(requestedTargetMs: number) {
  if (!drag || !drag.allowReorder) return
  const overrides = new Map<string, number>([[drag.identity, requestedTargetMs]])
  const next = orderFromTargets(drag.airport, drag.runway, overrides)
  if (!next.length) return
  const current = currentGroupOrder(drag.airport, drag.runway)
  if (sameOrder(current, next)) return
  groupOrders.set(groupKey(drag.airport, drag.runway), next)
  publishOrderSnapshot()
  drag.row.dataset.sequenceReordered = 'true'
}

function groupHasManualRows(airport: string, runway: string) {
  return rowsForGroup(airport, runway).some((row) =>
    row.classList.contains('is-stable') || row.dataset.targetMode === 'MANUAL')
}

function reconcileGroupAfterRender(airport: string, runway: string) {
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      const key = groupKey(airport, runway)
      if (!groupHasManualRows(airport, runway)) {
        groupOrders.delete(key)
        publishOrderSnapshot()
        return
      }
      const order = orderFromTargets(airport, runway)
      if (order.length) groupOrders.set(key, order)
      else groupOrders.delete(key)
      publishOrderSnapshot()
    })
  }, 0)
}

function syncSharedManualOrder(detail: SharedStateDetail | undefined) {
  const states = detail?.flightStates || []
  if (!states.length) return

  const manualByIdentity = new Map<string, SharedFlightState>()
  for (const state of states) {
    if (!state.airport || !state.callsign) continue
    manualByIdentity.set(amanSequenceOrderIdentity(state.airport, state.callsign), state)
  }

  const groups = new Map<string, { airport: string; runway: string; rows: HTMLElement[] }>()
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const identity = rowIdentity(row)
    if (!identity) return
    const shared = manualByIdentity.get(identity.identity)
    const runway = shared?.target_mode === 'MANUAL' && shared.manual_runway
      ? shared.manual_runway.toUpperCase()
      : rowRunway(row)
    if (!runway) return
    const key = groupKey(identity.airport, runway)
    const group = groups.get(key) ?? { airport: identity.airport, runway, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  })

  for (const [key, group] of groups) {
    const entries = group.rows.map((row, fallbackIndex) => {
      const identity = rowIdentity(row)!
      const shared = manualByIdentity.get(identity.identity)
      const manualMs = shared?.target_mode === 'MANUAL' && shared.manual_tldt
        ? new Date(shared.manual_tldt).getTime()
        : NaN
      const target = Number.isFinite(manualMs) ? manualMs : rowTargetMs(row)
      return target == null ? null : {
        identity: identity.identity,
        target,
        fallbackIndex,
        isManual: shared?.target_mode === 'MANUAL',
      }
    }).filter((item): item is { identity: string; target: number; fallbackIndex: number; isManual: boolean } => item !== null)

    if (!entries.some((item) => item.isManual)) continue
    entries.sort((a, b) => a.target - b.target || a.fallbackIndex - b.fallbackIndex)
    groupOrders.set(key, entries.map((item) => item.identity))
  }

  publishOrderSnapshot()
}

export function installManualSequenceReorderRuntime() {
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    const runway = rowRunway(row)
    const targetMs = rowTargetMs(row)
    if (!identity || !runway || targetMs == null) return

    drag = {
      pointerId: event.pointerId,
      row,
      identity: identity.identity,
      airport: identity.airport,
      runway,
      startY: event.clientY,
      startTargetMs: targetMs,
      allowReorder: event.altKey,
      moved: false,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId || !drag.allowReorder) return
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaY) <= MOVE_TOLERANCE_PX) return
    drag.moved = true
    const requestedTargetMs = drag.startTargetMs + (-deltaY / TIMELINE_DISPLAY_PX_PER_MINUTE) * 60_000
    updateDragOrder(requestedTargetMs)
  }

  const onPointerEnd = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const finished = drag
    drag = null
    if (finished.allowReorder && finished.moved) reconcileGroupAfterRender(finished.airport, finished.runway)
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    const runway = rowRunway(row)
    if (identity && runway) reconcileGroupAfterRender(identity.airport, runway)
  }

  const onChange = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement) || !target.closest('.runway-assignment')) return
    const row = target.closest<HTMLElement>('.aman-flight-row')
    const identity = row ? rowIdentity(row) : null
    if (!row || !identity) return
    window.setTimeout(() => {
      const runways = new Set(
        Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row'))
          .filter((item) => rowIdentity(item)?.airport === identity.airport)
          .map(rowRunway)
          .filter(Boolean),
      )
      runways.forEach((runway) => reconcileGroupAfterRender(identity.airport, runway))
    }, 0)
  }

  const onSharedState = (event: Event) => {
    syncSharedManualOrder((event as CustomEvent<SharedStateDetail>).detail)
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerEnd, true)
  document.addEventListener('pointercancel', onPointerEnd, true)
  window.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('change', onChange, true)
  window.addEventListener('aman:shared-state', onSharedState)

  return () => {
    drag = null
    groupOrders.clear()
    setAmanManualSequenceOrderSnapshot({})
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerEnd, true)
    document.removeEventListener('pointercancel', onPointerEnd, true)
    window.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('change', onChange, true)
    window.removeEventListener('aman:shared-state', onSharedState)
  }
}
