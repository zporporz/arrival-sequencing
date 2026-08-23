import {
  amanSequenceOrderIdentity,
  setAmanManualSequenceOrderSnapshot,
} from './core/arrivalSequencing'
import { TIMELINE_LOGICAL_PX_PER_MINUTE } from './timelineScale'

type SharedFlightState = {
  airport: string
  callsign: string
  target_mode?: 'AUTO' | 'MANUAL' | null
  manual_tldt?: string | null
  manual_runway?: string | null
}

type SharedStateDetail = { flightStates?: SharedFlightState[] }

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

type DragOrderState = {
  pointerId: number
  row: HTMLElement
  identity: string
  airport: string
  runway: string
  startOrder: string[]
  slotTargets: number[]
  targetIndex: number
  moved: boolean
  startY: number
  forceReorder: boolean
  dropTarget: HTMLElement | null
}

const MOVE_TOLERANCE_PX = 4
const DROP_PROXIMITY_PX = 4
const POINTER_ID = 70424
const groupOrders = new Map<string, string[]>()
let drag: DragOrderState | null = null

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function fakePointer(clientY: number, pointerId = POINTER_ID, row: HTMLElement | null = null): FakePointerEvent {
  return {
    button: 0,
    preventDefault: () => {},
    currentTarget: row ? {
      setPointerCapture: (id) => {
        try { row.setPointerCapture?.(id) } catch { /* no-op */ }
      },
      hasPointerCapture: (id) => {
        try { return row.hasPointerCapture?.(id) ?? false } catch { return false }
      },
      releasePointerCapture: (id) => {
        try {
          if (row.hasPointerCapture?.(id)) row.releasePointerCapture?.(id)
        } catch { /* no-op */ }
      },
    } : {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    },
    pointerId,
    clientY,
  }
}

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

  const text = row.querySelector<HTMLElement>('.tldt')?.textContent?.trim() || ''
  const hm = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!hm) return null
  const now = new Date()
  const candidate = new Date(now)
  candidate.setUTCHours(Number(hm[1]), Number(hm[2]), Number(hm[3] || 0), 0)
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

function rowByIdentity(airport: string, runway: string, identity: string) {
  return rowsForGroup(airport, runway).find((row) => rowIdentity(row)?.identity === identity) ?? null
}

function orderFromTargets(airport: string, runway: string) {
  return rowsForGroup(airport, runway)
    .map((row, fallbackIndex) => {
      const identity = rowIdentity(row)
      const target = rowTargetMs(row)
      if (!identity || target == null) return null
      return { identity: identity.identity, target, fallbackIndex }
    })
    .filter((item): item is { identity: string; target: number; fallbackIndex: number } => item !== null)
    .sort((a, b) => a.target - b.target || a.fallbackIndex - b.fallbackIndex)
    .map((item) => item.identity)
}

function currentGroupOrder(airport: string, runway: string) {
  const currentRows = new Set(rowsForGroup(airport, runway).map((row) => rowIdentity(row)?.identity).filter(Boolean) as string[])
  const stored = groupOrders.get(groupKey(airport, runway))?.filter((identity) => currentRows.has(identity)) ?? []
  if (stored.length === currentRows.size && stored.length > 0) return stored
  return orderFromTargets(airport, runway)
}

function currentSlotTargets(airport: string, runway: string) {
  return rowsForGroup(airport, runway)
    .map(rowTargetMs)
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b)
}

function publishOrderSnapshot() {
  const snapshot: Record<string, number> = {}
  for (const order of groupOrders.values()) {
    order.forEach((identity, index) => { snapshot[identity] = index + 1 })
  }
  setAmanManualSequenceOrderSnapshot(snapshot)
}

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
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
      const existing = groupOrders.get(key)
      const currentRows = new Set(rowsForGroup(airport, runway).map((row) => rowIdentity(row)?.identity).filter(Boolean) as string[])
      const retained = existing?.filter((identity) => currentRows.has(identity)) ?? []
      if (retained.length === currentRows.size && retained.length > 0) {
        groupOrders.set(key, retained)
      } else {
        const order = orderFromTargets(airport, runway)
        if (order.length) groupOrders.set(key, order)
        else groupOrders.delete(key)
      }
      publishOrderSnapshot()
    })
  }, 80)
}

function applyTarget(row: HTMLElement, targetMs: number) {
  const currentMs = rowTargetMs(row)
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false
  if (Math.abs(currentMs - targetMs) <= 2_000) return true

  const deltaMinutes = (targetMs - currentMs) / 60_000
  const clientY = -deltaMinutes * TIMELINE_LOGICAL_PX_PER_MINUTE
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(clientY))
  props.onPointerUp(fakePointer(clientY))
  return true
}

function insertionIndexFromPointer(state: DragOrderState, pointerY: number) {
  const otherOrder = state.startOrder.filter((identity) => identity !== state.identity)
  let index = 0

  for (const identity of otherOrder) {
    const row = rowByIdentity(state.airport, state.runway, identity)
    if (!row) continue
    const rect = row.getBoundingClientRect()
    const centreY = rect.top + rect.height / 2
    if (centreY > pointerY) index += 1
  }

  return Math.max(0, Math.min(otherOrder.length, index))
}

function reorderedOrder(state: DragOrderState) {
  const otherOrder = state.startOrder.filter((identity) => identity !== state.identity)
  const next = [...otherOrder]
  next.splice(state.targetIndex, 0, state.identity)
  return next
}

function applyReorderedSlots(state: DragOrderState, nextOrder: string[]) {
  if (nextOrder.length !== state.slotTargets.length) return false

  groupOrders.set(groupKey(state.airport, state.runway), nextOrder)
  publishOrderSnapshot()

  nextOrder.forEach((identity, index) => {
    const row = rowByIdentity(state.airport, state.runway, identity)
    const target = state.slotTargets[index]
    if (row && Number.isFinite(target)) applyTarget(row, target)
  })

  window.dispatchEvent(new CustomEvent('aman:sequence-reordered', {
    detail: { identities: nextOrder, airport: state.airport, runway: state.runway },
  }))
  return true
}

function clearDropPreview(state = drag) {
  if (!state?.dropTarget) return
  delete state.dropTarget.dataset.sequenceReorderDropTarget
  delete state.dropTarget.dataset.sequenceReorderPreviewOnly
  state.dropTarget = null
}

function isDownwardDrag(state: DragOrderState, pointerY: number) {
  return pointerY - state.startY >= MOVE_TOLERANCE_PX
}

function validDropTarget(state: DragOrderState, pointerX: number, pointerY: number) {
  const allowed = rowsForGroup(state.airport, state.runway).filter((row) => row !== state.row)
  if (!allowed.length) return null

  const direct = document.elementsFromPoint(pointerX, pointerY)
    .map((element) => element.closest<HTMLElement>('.aman-flight-row'))
    .find((row): row is HTMLElement => Boolean(row && allowed.includes(row)))
  if (direct) return direct

  let nearest: HTMLElement | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const row of allowed) {
    const rect = row.getBoundingClientRect()
    if (pointerX < rect.left || pointerX > rect.right) continue
    const distance = pointerY < rect.top
      ? rect.top - pointerY
      : pointerY > rect.bottom
        ? pointerY - rect.bottom
        : 0
    if (distance <= DROP_PROXIMITY_PX && distance < nearestDistance) {
      nearest = row
      nearestDistance = distance
    }
  }
  return nearest
}

function updateDropPreview(state: DragOrderState, event: PointerEvent) {
  const target = validDropTarget(state, event.clientX, event.clientY)
  if (state.dropTarget !== target) {
    clearDropPreview(state)
    state.dropTarget = target
  }
  if (!target) return

  target.dataset.sequenceReorderDropTarget = 'true'
  state.targetIndex = insertionIndexFromPointer(state, event.clientY)
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
    const identities = new Set(group.rows.map((row) => rowIdentity(row)?.identity).filter(Boolean) as string[])
    const existing = groupOrders.get(key)?.filter((identity) => identities.has(identity)) ?? []

    // Once a local/explicit sequence order has been latched, shared manual TLDT updates
    // are timing changes only and must never silently re-rank the sequence.
    if (existing.length === identities.size && existing.length > 0) continue

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
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return

    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    const runway = rowRunway(row)
    if (!identity || !runway) return

    const startOrder = currentGroupOrder(identity.airport, runway)
    const slotTargets = currentSlotTargets(identity.airport, runway)
    const startIndex = startOrder.indexOf(identity.identity)
    if (startIndex < 0 || startOrder.length !== slotTargets.length) return

    // Latch order before React starts changing TLDT. An upward drag is timing-only and
    // the normal pairwise cascade therefore pushes every later follower in real time.
    groupOrders.set(groupKey(identity.airport, runway), [...startOrder])
    publishOrderSnapshot()

    const forceReorder = event.pointerType === 'mouse' && event.shiftKey
    drag = {
      pointerId: event.pointerId,
      row,
      identity: identity.identity,
      airport: identity.airport,
      runway,
      startOrder,
      slotTargets,
      targetIndex: startIndex,
      moved: false,
      startY: event.clientY,
      forceReorder,
      dropTarget: null,
    }

    if (!forceReorder) return

    row.dataset.sequenceReorderDragging = 'true'
    try { row.setPointerCapture?.(event.pointerId) } catch { /* no-op */ }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (Math.abs(event.clientY - drag.startY) >= MOVE_TOLERANCE_PX) drag.moved = true

    const downward = isDownwardDrag(drag, event.clientY)

    if (drag.forceReorder) {
      if (downward) updateDropPreview(drag, event)
      else clearDropPreview(drag)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (!downward) {
      // Upward = pure live TLDT push. Do not run any drop/reorder targeting at all.
      // Let React's pointermove update the dragged TLDT immediately; its cascade then
      // moves all later followers at the same time according to the latched order + SEP.
      clearDropPreview(drag)
      return
    }

    // Downward keeps the existing explicit replace behaviour. Only this direction uses
    // a yellow drop target and can commit a sequence reorder on release.
    updateDropPreview(drag, event)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const finished = drag
    const downward = isDownwardDrag(finished, event.clientY)

    if (downward) updateDropPreview(finished, event)
    else clearDropPreview(finished)

    const shouldReorder = finished.moved && downward && Boolean(finished.dropTarget)

    if (!shouldReorder) {
      clearDropPreview(finished)
      delete finished.row.dataset.sequenceReorderDragging
      delete finished.row.dataset.sequenceReorderTarget
      drag = null

      if (!finished.forceReorder) {
        // Upward/empty release only ends the already-live TLDT drag. No reorder or slot
        // replacement happens here; followers have already moved through normal cascade.
        return
      }

      try {
        if (finished.row.hasPointerCapture?.(event.pointerId)) finished.row.releasePointerCapture?.(event.pointerId)
      } catch { /* no-op */ }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    if (finished.forceReorder) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    } else {
      reactProps<ReactRowProps>(finished.row)?.onPointerUp?.(
        fakePointer(event.clientY, event.pointerId, finished.row),
      )
    }

    finished.targetIndex = insertionIndexFromPointer(finished, event.clientY)
    const nextOrder = reorderedOrder(finished)
    clearDropPreview(finished)
    delete finished.row.dataset.sequenceReorderDragging
    delete finished.row.dataset.sequenceReorderTarget
    drag = null

    if (!sameOrder(finished.startOrder, nextOrder)) {
      applyReorderedSlots(finished, nextOrder)
      reconcileGroupAfterRender(finished.airport, finished.runway)
    }
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const cancelled = drag
    clearDropPreview(cancelled)
    delete cancelled.row.dataset.sequenceReorderDragging
    delete cancelled.row.dataset.sequenceReorderTarget
    drag = null
    if (!cancelled.forceReorder) return
    try {
      if (cancelled.row.hasPointerCapture?.(event.pointerId)) cancelled.row.releasePointerCapture?.(event.pointerId)
    } catch { /* no-op */ }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
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
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  window.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('change', onChange, true)
  window.addEventListener('aman:shared-state', onSharedState)

  return () => {
    clearDropPreview()
    drag = null
    groupOrders.clear()
    setAmanManualSequenceOrderSnapshot({})
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    window.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('change', onChange, true)
    window.removeEventListener('aman:shared-state', onSharedState)
  }
}
