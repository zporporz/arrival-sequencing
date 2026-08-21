import {
  TIMELINE_DISPLAY_PX_PER_MINUTE,
  TIMELINE_LOGICAL_PX_PER_MINUTE,
  TIMELINE_DISPLAY_SCALE,
} from './timelineScale'

type ReactRowProps = {
  onPointerMove?: (event: FakePointerEvent) => void
}

type FakePointerEvent = {
  preventDefault: () => void
  currentTarget: {
    setPointerCapture: (pointerId: number) => void
    hasPointerCapture: (pointerId: number) => boolean
    releasePointerCapture: (pointerId: number) => void
  }
  pointerId: number
  clientY: number
}

type DragMode = 'VISUAL' | 'TARGET'

type DragState = {
  mode: DragMode
  row: HTMLElement
  key: string
  pointerId: number
  startClientY: number
  startDisplayOffsetPx: number
  lastDisplayOffsetPx: number
}

const VISUAL_SNAP_PX = 10
const VISUAL_JOIN_GAP_PX = 0
const visualDeltaByKey = new Map<string, number>()

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function rowIdealDisplayOffset(row: HTMLElement) {
  const logicalOffset = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (!Number.isFinite(logicalOffset)) return null
  return Math.round(logicalOffset * TIMELINE_DISPLAY_SCALE * 100) / 100
}

function rowDisplayOffset(row: HTMLElement) {
  const displayed = Number.parseFloat(row.style.getPropertyValue('--display-offset-px'))
  if (Number.isFinite(displayed)) return displayed
  const ideal = rowIdealDisplayOffset(row)
  if (ideal == null) return null
  return ideal + (visualDeltaByKey.get(rowKey(row)) ?? 0)
}

function rowDisplaySide(row: HTMLElement) {
  return row.dataset.displaySide === 'LEFT' || row.classList.contains('display-left') ? 'LEFT' : 'RIGHT'
}

function rowKey(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  return airport && callsign ? `${airport}:${callsign}` : ''
}

function rowHeight(row: HTMLElement) {
  const height = row.getBoundingClientRect().height
  return Number.isFinite(height) && height > 0 ? height : 18
}

function setDisplayOffset(row: HTMLElement, displayOffsetPx: number, idealOffsetPx: number) {
  const display = `${Math.round(displayOffsetPx * 100) / 100}px`
  const ideal = `${Math.round(idealOffsetPx * 100) / 100}px`
  if (row.style.getPropertyValue('--display-offset-px') !== display) row.style.setProperty('--display-offset-px', display)
  if (row.style.getPropertyValue('--ideal-display-offset-px') !== ideal) row.style.setProperty('--ideal-display-offset-px', ideal)

  const key = rowKey(row)
  const visualDelta = key ? visualDeltaByKey.get(key) ?? 0 : 0
  row.dataset.visualStripMoved = Math.abs(visualDelta) >= 0.5 ? 'true' : 'false'
  row.dataset.timelinePacked = 'false'
}

function applyStoredVisualPositions(exceptRow?: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    if (row === exceptRow) return
    const ideal = rowIdealDisplayOffset(row)
    if (ideal == null) return
    const key = rowKey(row)
    const delta = key ? visualDeltaByKey.get(key) ?? 0 : 0
    setDisplayOffset(row, ideal + delta, ideal)
  })
}

function sameSideRows(row: HTMLElement) {
  const side = rowDisplaySide(row)
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).filter((candidate) =>
    candidate !== row && rowDisplaySide(candidate) === side,
  )
}

function touchingDistance(row: HTMLElement, other: HTMLElement) {
  return (rowHeight(row) + rowHeight(other)) / 2 + VISUAL_JOIN_GAP_PX
}

function snapCandidate(row: HTMLElement, rawOffset: number) {
  const ideal = rowIdealDisplayOffset(row)
  let best = rawOffset
  let bestDistance = VISUAL_SNAP_PX + 0.001

  // Dragging back near the real-time position automatically re-aligns the strip.
  if (ideal != null) {
    const distance = Math.abs(rawOffset - ideal)
    if (distance < bestDistance) {
      best = ideal
      bestDistance = distance
    }
  }

  for (const other of sameSideRows(row)) {
    const otherOffset = rowDisplayOffset(other)
    if (otherOffset == null) continue
    const spacing = touchingDistance(row, other)
    for (const candidate of [otherOffset - spacing, otherOffset + spacing]) {
      const distance = Math.abs(rawOffset - candidate)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
  }

  return bestDistance <= VISUAL_SNAP_PX ? best : rawOffset
}

function avoidOverlap(row: HTMLElement, requestedOffset: number, direction: number) {
  let candidate = requestedOffset
  const others = sameSideRows(row)
  const pushDirection = direction === 0 ? 1 : Math.sign(direction)

  for (let pass = 0; pass < others.length + 2; pass += 1) {
    let changed = false
    for (const other of others) {
      const otherOffset = rowDisplayOffset(other)
      if (otherOffset == null) continue
      const spacing = touchingDistance(row, other)
      if (Math.abs(candidate - otherOffset) >= spacing - 0.25) continue

      candidate = pushDirection >= 0
        ? otherOffset + spacing
        : otherOffset - spacing
      changed = true
    }
    if (!changed) break
  }

  return candidate
}

function visualDragOffset(row: HTMLElement, rawOffset: number, direction: number) {
  const snapped = snapCandidate(row, rawOffset)
  return avoidOverlap(row, snapped, direction)
}

function fakePointer(row: HTMLElement, pointerId: number, clientY: number): FakePointerEvent {
  return {
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      hasPointerCapture: (id) => row.hasPointerCapture?.(id) ?? false,
      releasePointerCapture: (id) => {
        if (row.hasPointerCapture?.(id)) row.releasePointerCapture?.(id)
      },
    },
    pointerId,
    clientY,
  }
}

export function installTimelineDisplayScaleRuntime() {
  let drag: DragState | null = null
  let scheduled = false
  let disposed = false

  const scheduleApply = () => {
    if (disposed || scheduled || drag) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed && !drag) applyStoredVisualPositions()
    })
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    const key = rowKey(row)
    const ideal = rowIdealDisplayOffset(row)
    if (!key || ideal == null) return

    const displayed = rowDisplayOffset(row) ?? ideal
    const mode: DragMode = event.target.closest('.tldt') ? 'TARGET' : 'VISUAL'
    drag = {
      mode,
      row,
      key,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startDisplayOffsetPx: displayed,
      lastDisplayOffsetPx: displayed,
    }

    if (mode === 'VISUAL') {
      row.dataset.visualDragging = 'true'
      try { row.setPointerCapture?.(event.pointerId) } catch { /* no-op */ }
      // Body drag is presentation-only. Do not let React convert it into a TLDT change.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return

    const physicalDelta = event.clientY - drag.startClientY
    if (drag.mode === 'VISUAL') {
      const raw = drag.startDisplayOffsetPx + physicalDelta
      const next = visualDragOffset(drag.row, raw, physicalDelta)
      drag.lastDisplayOffsetPx = next
      const ideal = rowIdealDisplayOffset(drag.row) ?? drag.startDisplayOffsetPx
      setDisplayOffset(drag.row, next, ideal)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return
    }

    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return
    const logicalDelta = physicalDelta * TIMELINE_LOGICAL_PX_PER_MINUTE / TIMELINE_DISPLAY_PX_PER_MINUTE
    const logicalClientY = drag.startClientY + logicalDelta
    const ideal = rowIdealDisplayOffset(drag.row) ?? drag.startDisplayOffsetPx

    // TLDT-cell drag keeps the historical target-time behavior.
    drag.lastDisplayOffsetPx = drag.startDisplayOffsetPx + physicalDelta
    setDisplayOffset(drag.row, drag.lastDisplayOffsetPx, ideal)
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    props.onPointerMove(fakePointer(drag.row, event.pointerId, logicalClientY))
  }

  const finishDrag = (event?: PointerEvent) => {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    const finished = drag
    drag = null

    if (finished.mode === 'VISUAL') {
      const ideal = rowIdealDisplayOffset(finished.row)
      if (ideal != null) {
        const delta = finished.lastDisplayOffsetPx - ideal
        if (Math.abs(delta) < 0.5) visualDeltaByKey.delete(finished.key)
        else visualDeltaByKey.set(finished.key, delta)
      }
      delete finished.row.dataset.visualDragging
      if (event) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
    }

    scheduleApply()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', finishDrag, true)
  document.addEventListener('pointercancel', finishDrag, true)

  applyStoredVisualPositions()
  const observer = new MutationObserver(scheduleApply)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'data-display-side'],
  })
  const timer = window.setInterval(scheduleApply, 500)

  return () => {
    disposed = true
    drag = null
    observer.disconnect()
    window.clearInterval(timer)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', finishDrag, true)
    document.removeEventListener('pointercancel', finishDrag, true)
    visualDeltaByKey.clear()
    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      row.style.removeProperty('--display-offset-px')
      row.style.removeProperty('--ideal-display-offset-px')
      delete row.dataset.timelinePacked
      delete row.dataset.visualStripMoved
      delete row.dataset.visualDragging
    })
  }
}
