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

type SharedSequenceOrder = {
  airport: string
  runway: string
  ordered_callsigns: string[]
  revision?: number
}

type SharedStateDetail = {
  flightStates?: SharedFlightState[]
  sequenceOrders?: SharedSequenceOrder[]
}

type ReturnFlightAutoDetail = {
  airport?: string
  runway?: string
  identity?: string
  autoTldt?: string
}

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
  currentOrder: string[]
  targetIndex: number
  orderChanged: boolean
  moved: boolean
  startY: number
  lastY: number
  dropTarget: HTMLElement | null
}

const MOVE_TOLERANCE_PX = 4
const DROP_PROXIMITY_PX = 20
const POINTER_ID = 70424
const VTBD_AIRPORT_SEQUENCE_SCOPE = 'ALL'
const SEQUENCE_ORDER_WRITE_ATTEMPTS = 3
const groupOrders = new Map<string, string[]>()
const sharedOrderRevisions = new Map<string, number>()
const pendingOrderWrites = new Map<string, { order: string[] }>()
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

export function amanSequenceScopeRunway(airport: string, runway: string) {
  return airport.trim().toUpperCase() === 'VTBD'
    ? VTBD_AIRPORT_SEQUENCE_SCOPE
    : runway.trim().toUpperCase()
}

function groupKey(airport: string, runway: string) {
  return `${airport}:${amanSequenceScopeRunway(airport, runway)}`
}

function rowsForGroup(airport: string, runway: string) {
  const scopeRunway = amanSequenceScopeRunway(airport, runway)
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).filter((row) => {
    const identity = rowIdentity(row)
    if (identity?.airport !== airport) return false
    return scopeRunway === VTBD_AIRPORT_SEQUENCE_SCOPE || rowRunway(row) === scopeRunway
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
  const visibleOrder = orderFromTargets(airport, runway)
  return stored.length ? mergeVisibleSequenceOrder(stored, visibleOrder) : visibleOrder
}

export function mergeVisibleSequenceOrder(existingOrder: readonly string[], visibleTargetOrder: readonly string[]) {
  const visible = new Set(visibleTargetOrder)
  const result = existingOrder.filter((identity, index, values) => visible.has(identity) && values.indexOf(identity) === index)
  const retained = new Set(result)

  for (const identity of visibleTargetOrder) {
    if (retained.has(identity)) continue
    const targetPosition = visibleTargetOrder.indexOf(identity)
    const insertionIndex = result.findIndex((retainedIdentity) => visibleTargetOrder.indexOf(retainedIdentity) > targetPosition)
    if (insertionIndex < 0) result.push(identity)
    else result.splice(insertionIndex, 0, identity)
    retained.add(identity)
  }

  return result
}

function publishOrderSnapshot() {
  const snapshot: Record<string, number> = {}
  for (const order of groupOrders.values()) {
    order.forEach((identity, index) => { snapshot[identity] = index + 1 })
  }
  setAmanManualSequenceOrderSnapshot(snapshot)
}

function callsignFromIdentity(identity: string) {
  return identity.slice(identity.indexOf(':') + 1)
}

export function sequenceOrderRetryDelayMs(failedAttempt: number) {
  return Math.min(2_000, 300 * 2 ** Math.max(0, failedAttempt))
}

function waitForRetry(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

async function persistSequenceOrder(
  airport: string,
  runway: string,
  pending: { order: string[] },
) {
  const rows = rowsForGroup(airport, runway)
  if (!rows.length || rows.every((row) => row.classList.contains('is-demo'))) return
  const key = groupKey(airport, runway)
  let lastError: unknown = null

  for (let attempt = 0; attempt < SEQUENCE_ORDER_WRITE_ATTEMPTS; attempt += 1) {
    if (pendingOrderWrites.get(key) !== pending) return
    try {
      const response = await fetch('/api/sequence/aman-state', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'setSequenceOrder',
          serviceDate: new Date().toISOString().slice(0, 10),
          airport,
          runway: amanSequenceScopeRunway(airport, runway),
          orderedCallsigns: pending.order.map(callsignFromIdentity),
        }),
      })
      const payload = await response.json() as { error?: string; sequenceOrder?: SharedSequenceOrder }
      if (!response.ok) throw new Error(payload.error || `Shared AMAN API returned ${response.status}`)
      if (pendingOrderWrites.get(key) === pending) {
        pendingOrderWrites.delete(key)
        const revision = Number(payload.sequenceOrder?.revision)
        if (Number.isFinite(revision)) sharedOrderRevisions.set(key, Math.max(sharedOrderRevisions.get(key) ?? 0, revision))
      }
      window.dispatchEvent(new Event('aman:force-shared-refresh'))
      if (payload.sequenceOrder) {
        window.dispatchEvent(new CustomEvent('aman:realtime-commit-request', {
          detail: { airport, sequenceOrder: payload.sequenceOrder },
        }))
      }
      return
    } catch (error) {
      lastError = error
      if (attempt < SEQUENCE_ORDER_WRITE_ATTEMPTS - 1) {
        await waitForRetry(sequenceOrderRetryDelayMs(attempt))
      }
    }
  }

  if (pendingOrderWrites.get(key) === pending) pendingOrderWrites.delete(key)
  window.dispatchEvent(new CustomEvent('aman:shared-state-health', {
    detail: { status: 'ERROR', detail: lastError instanceof Error ? lastError.message : String(lastError) },
  }))
  // Release the optimistic guard and immediately re-read the authoritative server
  // order so a failed local write cannot leave this controller permanently divergent.
  window.dispatchEvent(new Event('aman:force-shared-refresh'))
}

function commitSharedOrder(airport: string, runway: string, order: readonly string[]) {
  const key = groupKey(airport, runway)
  groupOrders.set(key, [...order])
  publishOrderSnapshot()
  const rows = rowsForGroup(airport, runway)
  if (!rows.length || rows.every((row) => row.classList.contains('is-demo'))) return
  const pending = { order: [...order] }
  pendingOrderWrites.set(key, pending)
  void persistSequenceOrder(airport, runway, pending)
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
        const order = mergeVisibleSequenceOrder(retained, orderFromTargets(airport, runway))
        if (order.length) groupOrders.set(key, order)
        else groupOrders.delete(key)
      }
      publishOrderSnapshot()
    })
  }, 80)
}

export function sequenceInsertionIndexForTarget(
  startOrder: readonly string[],
  draggedIdentity: string,
  targetIdentity: string,
) {
  const otherOrder = startOrder.filter((identity) => identity !== draggedIdentity)
  const targetIndex = otherOrder.indexOf(targetIdentity)
  return targetIndex >= 0 ? targetIndex : Math.max(0, otherOrder.length)
}

export function sequenceOrderForTarget(
  startOrder: readonly string[],
  draggedIdentity: string,
  targetIdentity: string,
) {
  const otherOrder = startOrder.filter((identity) => identity !== draggedIdentity)
  const next = [...otherOrder]
  next.splice(sequenceInsertionIndexForTarget(startOrder, draggedIdentity, targetIdentity), 0, draggedIdentity)
  return next
}

export function sequenceTargetChangesOrder(
  startOrder: readonly string[],
  draggedIdentity: string,
  targetIdentity: string,
) {
  return !sameOrder(startOrder, sequenceOrderForTarget(startOrder, draggedIdentity, targetIdentity))
}

export function sequenceOrderAfterCrossedTargets(
  currentOrder: readonly string[],
  draggedIdentity: string,
  crossedTargetIdentities: readonly string[],
) {
  return crossedTargetIdentities.reduce<string[]>((order, targetIdentity) => {
    if (targetIdentity === draggedIdentity || !order.includes(targetIdentity)) return order
    return sequenceOrderForTarget(order, draggedIdentity, targetIdentity)
  }, [...currentOrder])
}

export function sequenceOrderAfterAutoReturn(
  currentOrder: readonly string[],
  returnedIdentity: string,
  returnedTargetMs: number,
  targetMsByIdentity: Readonly<Record<string, number>>,
) {
  const retained = currentOrder.filter((identity, index, values) =>
    identity !== returnedIdentity && values.indexOf(identity) === index)
  const insertionIndex = retained.findIndex((identity) => {
    const targetMs = targetMsByIdentity[identity]
    return Number.isFinite(targetMs) && targetMs > returnedTargetMs
  })
  const next = [...retained]
  next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, returnedIdentity)
  return next
}

function commitReorderedSequence(state: DragOrderState, nextOrder: string[]) {
  commitSharedOrder(state.airport, state.runway, nextOrder)
  // Reordering changes rank only. Keep the dragged aircraft's actual manual TLDT
  // (for example, a shortcut to 15:20) instead of assigning the old 15:25 slot.
  // The normal React cascade then moves only followers whose separation is short.
  window.dispatchEvent(new CustomEvent('aman:sequence-reordered', {
    detail: {
      identities: nextOrder,
      airport: state.airport,
      runway: state.runway,
      manualIdentity: state.identity,
    },
  }))
}

function clearDropPreview(state = drag) {
  if (!state?.dropTarget) return
  delete state.dropTarget.dataset.sequenceReorderDropTarget
  delete state.dropTarget.dataset.sequenceReorderPreviewOnly
  state.dropTarget = null
}

export function isDownwardSequenceDrag(startY: number, pointerY: number) {
  return pointerY - startY >= MOVE_TOLERANCE_PX
}

export function shouldCommitSequenceReorder(input: {
  startY: number
  pointerY: number
  moved: boolean
  hasDropTarget: boolean
}) {
  return input.moved
    && isDownwardSequenceDrag(input.startY, input.pointerY)
    && input.hasDropTarget
}

function isDownwardDrag(state: DragOrderState, pointerY: number) {
  return isDownwardSequenceDrag(state.startY, pointerY)
}

export function isWithinSequenceDropZone(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  pointerX: number,
  pointerY: number,
) {
  if (pointerX < rect.left || pointerX > rect.right) return false
  const distance = pointerY < rect.top
    ? rect.top - pointerY
    : pointerY > rect.bottom
      ? pointerY - rect.bottom
      : 0
  return distance <= DROP_PROXIMITY_PX
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
    if (!isWithinSequenceDropZone(rect, pointerX, pointerY)) continue
    const distance = pointerY < rect.top
      ? rect.top - pointerY
      : pointerY > rect.bottom
        ? pointerY - rect.bottom
        : 0
    if (distance < nearestDistance) {
      nearest = row
      nearestDistance = distance
    }
  }
  return nearest
}

function updateDropPreview(state: DragOrderState, event: PointerEvent) {
  const target = validDropTarget(state, event.clientX, event.clientY)
  const targetIdentity = target ? rowIdentity(target)?.identity : null
  const effectiveTarget = targetIdentity
    && sequenceTargetChangesOrder(state.startOrder, state.identity, targetIdentity)
    ? target
    : null
  if (state.dropTarget !== effectiveTarget) {
    clearDropPreview(state)
    state.dropTarget = effectiveTarget
  }
  if (!effectiveTarget || !targetIdentity) return

  effectiveTarget.dataset.sequenceReorderDropTarget = 'true'
  state.targetIndex = sequenceInsertionIndexForTarget(state.startOrder, state.identity, targetIdentity)
}

function crossedTargets(state: DragOrderState, event: PointerEvent) {
  if (event.clientY <= state.lastY) return []

  return rowsForGroup(state.airport, state.runway)
    .filter((row) => row !== state.row)
    .map((row) => {
      const rect = row.getBoundingClientRect()
      const identity = rowIdentity(row)?.identity || ''
      return { row, identity, rect, centerY: rect.top + rect.height / 2 }
    })
    .filter(({ identity, rect, centerY }) => identity
      && event.clientX >= rect.left
      && event.clientX <= rect.right
      && centerY > state.lastY
      && centerY <= event.clientY)
    .sort((a, b) => a.centerY - b.centerY)
}

function updateLiveDownwardOrder(state: DragOrderState, event: PointerEvent) {
  const crossed = crossedTargets(state, event)
  state.lastY = event.clientY
  if (!crossed.length) {
    updateDropPreview(state, event)
    return
  }

  const nextOrder = sequenceOrderAfterCrossedTargets(
    state.currentOrder,
    state.identity,
    crossed.map(({ identity }) => identity),
  )
  if (sameOrder(state.currentOrder, nextOrder)) return

  clearDropPreview(state)
  const latest = crossed.at(-1)!
  state.dropTarget = latest.row
  latest.row.dataset.sequenceReorderDropTarget = 'true'
  state.currentOrder = nextOrder
  state.targetIndex = nextOrder.indexOf(state.identity)
  state.orderChanged = !sameOrder(state.startOrder, nextOrder)

  // Re-rank locally as soon as the pointer crosses a callsign. Persistence waits for
  // pointerup so a single drag never floods the shared AMAN API with intermediate ranks.
  groupOrders.set(groupKey(state.airport, state.runway), [...nextOrder])
  publishOrderSnapshot()
  window.dispatchEvent(new CustomEvent('aman:sequence-reordered', {
    detail: { identities: nextOrder, airport: state.airport, runway: state.runway, preview: true },
  }))
}

function syncSharedManualOrder(detail: SharedStateDetail | undefined) {
  const explicitGroups = new Set<string>()
  for (const state of detail?.sequenceOrders || []) {
    const airport = String(state.airport || '').trim().toUpperCase()
    const runway = String(state.runway || '').trim().toUpperCase()
    if (!airport || !runway || !Array.isArray(state.ordered_callsigns)) continue
    // VTBD 21R/21L are one airport-wide stream. Ignore legacy per-runway rows;
    // the first reorder on the new runtime persists one authoritative ALL row.
    if (airport === 'VTBD' && runway !== VTBD_AIRPORT_SEQUENCE_SCOPE) continue
    const key = groupKey(airport, runway)
    explicitGroups.add(key)

    const remoteOrder = state.ordered_callsigns.map((callsign) => amanSequenceOrderIdentity(airport, callsign))
    const pending = pendingOrderWrites.get(key)
    if (pending && !sameOrder(pending.order, remoteOrder)) continue
    if (pending) pendingOrderWrites.delete(key)

    const revision = Number(state.revision) || 0
    if (revision < (sharedOrderRevisions.get(key) ?? 0)) continue
    sharedOrderRevisions.set(key, revision)

    const visibleOrder = orderFromTargets(airport, runway)
    const visible = new Set(visibleOrder)
    const remote = state.ordered_callsigns
      .map((callsign) => amanSequenceOrderIdentity(airport, callsign))
      .filter((identity, index, values) => visible.has(identity) && values.indexOf(identity) === index)
    const merged = mergeVisibleSequenceOrder(remote, visibleOrder)
    if (merged.length) groupOrders.set(key, merged)
    else groupOrders.delete(key)
  }

  const states = detail?.flightStates || []
  if (!states.length) {
    publishOrderSnapshot()
    return
  }

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
    const scopeRunway = amanSequenceScopeRunway(identity.airport, runway)
    const key = groupKey(identity.airport, scopeRunway)
    const group = groups.get(key) ?? { airport: identity.airport, runway: scopeRunway, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  })

  for (const [key, group] of groups) {
    if (explicitGroups.has(key)) continue
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
    const scopeRunway = amanSequenceScopeRunway(identity.airport, runway)

    const startOrder = currentGroupOrder(identity.airport, scopeRunway)
    const startIndex = startOrder.indexOf(identity.identity)
    if (startIndex < 0) return

    // Latch order before React starts changing TLDT. An upward drag is timing-only and
    // the normal pairwise cascade therefore pushes every later follower in real time.
    groupOrders.set(groupKey(identity.airport, scopeRunway), [...startOrder])
    publishOrderSnapshot()

    drag = {
      pointerId: event.pointerId,
      row,
      identity: identity.identity,
      airport: identity.airport,
      runway: scopeRunway,
      startOrder,
      currentOrder: [...startOrder],
      targetIndex: startIndex,
      orderChanged: false,
      moved: false,
      startY: event.clientY,
      lastY: event.clientY,
      dropTarget: null,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (Math.abs(event.clientY - drag.startY) >= MOVE_TOLERANCE_PX) drag.moved = true

    const downward = isDownwardDrag(drag, event.clientY)

    if (!downward) {
      // Upward = pure live TLDT push. Do not run any drop/reorder targeting at all.
      // Let React's pointermove update the dragged TLDT immediately; its cascade then
      // moves all later followers at the same time according to the latched order + SEP.
      clearDropPreview(drag)
      return
    }

    // Downward keeps the existing explicit replace behaviour. Only this direction uses
    // a yellow drop target and can commit a sequence reorder on release.
    updateLiveDownwardOrder(drag, event)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const finished = drag
    const downward = isDownwardDrag(finished, event.clientY)

    if (downward) updateLiveDownwardOrder(finished, event)
    else clearDropPreview(finished)

    const shouldReorder = downward && finished.orderChanged

    if (!shouldReorder) {
      clearDropPreview(finished)
      delete finished.row.dataset.sequenceReorderDragging
      delete finished.row.dataset.sequenceReorderTarget
      drag = null

      // Upward/empty release only ends the already-live TLDT drag. No reorder or slot
      // replacement happens here; followers have already moved through normal cascade.
      if (finished.moved) {
        commitSharedOrder(finished.airport, finished.runway, finished.startOrder)
      }
      return
    }

    const nextOrder = [...finished.currentOrder]
    const orderChanged = finished.orderChanged
    // Publish the new rank before React finalises the manual TLDT. The render caused
    // by onPointerUp will then cascade from the shortcut time using the new order.
    if (orderChanged) commitReorderedSequence(finished, nextOrder)

    reactProps<ReactRowProps>(finished.row)?.onPointerUp?.(
      fakePointer(event.clientY, event.pointerId, finished.row),
    )

    clearDropPreview(finished)
    delete finished.row.dataset.sequenceReorderDragging
    delete finished.row.dataset.sequenceReorderTarget
    drag = null

    if (orderChanged) {
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
      const scopes = new Set(Array.from(runways, (runway) => amanSequenceScopeRunway(identity.airport, runway)))
      scopes.forEach((runway) => reconcileGroupAfterRender(identity.airport, runway))
    }, 0)
  }

  const onSharedState = (event: Event) => {
    syncSharedManualOrder((event as CustomEvent<SharedStateDetail>).detail)
  }

  const onReturnFlightAuto = (event: Event) => {
    const detail = (event as CustomEvent<ReturnFlightAutoDetail>).detail
    const airport = String(detail?.airport || '').trim().toUpperCase()
    const runway = String(detail?.runway || '').trim().toUpperCase()
    const identity = String(detail?.identity || '').trim().toUpperCase()
    const autoTargetMs = new Date(String(detail?.autoTldt || '')).getTime()
    if (!airport || !runway || !identity || !Number.isFinite(autoTargetMs)) return

    const scopeRunway = amanSequenceScopeRunway(airport, runway)
    const currentOrder = currentGroupOrder(airport, scopeRunway)
    if (!currentOrder.includes(identity)) return

    const targetMsByIdentity: Record<string, number> = {}
    for (const row of rowsForGroup(airport, scopeRunway)) {
      const rowId = rowIdentity(row)?.identity
      const targetMs = rowTargetMs(row)
      if (rowId && targetMs != null) targetMsByIdentity[rowId] = targetMs
    }
    const nextOrder = sequenceOrderAfterAutoReturn(currentOrder, identity, autoTargetMs, targetMsByIdentity)
    if (sameOrder(currentOrder, nextOrder)) return

    // Release only this aircraft's manual rank. Other aircraft keep their relative
    // controller order, then the normal cascade recalculates separation once.
    commitSharedOrder(airport, scopeRunway, nextOrder)
    window.dispatchEvent(new CustomEvent('aman:sequence-reordered', {
      detail: { identities: nextOrder, airport, runway: scopeRunway, returnAuto: true },
    }))
    reconcileGroupAfterRender(airport, scopeRunway)
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  window.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('change', onChange, true)
  window.addEventListener('aman:shared-state', onSharedState)
  window.addEventListener('aman:return-flight-auto', onReturnFlightAuto)

  return () => {
    clearDropPreview()
    drag = null
    groupOrders.clear()
    sharedOrderRevisions.clear()
    pendingOrderWrites.clear()
    setAmanManualSequenceOrderSnapshot({})
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    window.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('change', onChange, true)
    window.removeEventListener('aman:shared-state', onSharedState)
    window.removeEventListener('aman:return-flight-auto', onReturnFlightAuto)
  }
}
