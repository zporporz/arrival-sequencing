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

type DragState = {
  row: HTMLElement
  key: string
  pointerId: number
  startClientY: number
  startDisplayOffsetPx: number
  lastDisplayOffsetPx: number
  lastPhysicalDeltaPx: number
}

const FALLBACK_ROW_HEIGHT_PX = 18
const VISUAL_SNAP_PX = 12
const MIN_VISUAL_GAP_PX = 0
const RESIDUAL_TOLERANCE_PX = 3

// Visual-only residual created when the controller keeps pulling after the real TLDT
// has already been constrained by separation/cascade. It never changes sequencing math.
const visualResidualByKey = new Map<string, number>()

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function rowKey(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  return airport && callsign ? `${airport}:${callsign}` : ''
}

function rowDisplaySide(row: HTMLElement) {
  return row.dataset.displaySide === 'LEFT' || row.classList.contains('display-left') ? 'LEFT' : 'RIGHT'
}

function rowIdealDisplayOffset(row: HTMLElement) {
  const logicalOffset = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (!Number.isFinite(logicalOffset)) return null
  return Math.round(logicalOffset * TIMELINE_DISPLAY_SCALE * 100) / 100
}

function rowCurrentDisplayOffset(row: HTMLElement) {
  const value = Number.parseFloat(row.style.getPropertyValue('--display-offset-px'))
  if (Number.isFinite(value)) return value
  const ideal = rowIdealDisplayOffset(row)
  if (ideal == null) return null
  const key = rowKey(row)
  return ideal + (key ? visualResidualByKey.get(key) ?? 0 : 0)
}

function rowHeightPx(row: HTMLElement) {
  const measured = row.getBoundingClientRect().height
  return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_ROW_HEIGHT_PX
}

function minimumSpacing(left: HTMLElement, right: HTMLElement) {
  return (rowHeightPx(left) + rowHeightPx(right)) / 2 + MIN_VISUAL_GAP_PX
}

function setDisplayOffset(row: HTMLElement, displayOffsetPx: number, idealOffsetPx: number) {
  const display = `${Math.round(displayOffsetPx * 100) / 100}px`
  const ideal = `${Math.round(idealOffsetPx * 100) / 100}px`
  if (row.style.getPropertyValue('--display-offset-px') !== display) row.style.setProperty('--display-offset-px', display)
  if (row.style.getPropertyValue('--ideal-display-offset-px') !== ideal) row.style.setProperty('--ideal-display-offset-px', ideal)
  row.dataset.timelinePacked = Math.abs(displayOffsetPx - idealOffsetPx) >= 0.5 ? 'true' : 'false'
  row.dataset.visualCompact = row.dataset.timelinePacked
}

function findRow(key: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((row) => rowKey(row) === key) ?? null
}

function sameSideRows(row: HTMLElement) {
  const side = rowDisplaySide(row)
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).filter((candidate) =>
    candidate !== row && rowDisplaySide(candidate) === side,
  )
}

function applyStoredVisualPositions(exceptRow?: HTMLElement | null) {
  const activeKeys = new Set<string>()
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    if (row === exceptRow) return
    const ideal = rowIdealDisplayOffset(row)
    const key = rowKey(row)
    if (ideal == null || !key) return
    activeKeys.add(key)
    setDisplayOffset(row, ideal + (visualResidualByKey.get(key) ?? 0), ideal)
  })

  for (const key of visualResidualByKey.keys()) {
    if (!activeKeys.has(key) && key !== (exceptRow ? rowKey(exceptRow) : '')) visualResidualByKey.delete(key)
  }
}

function nearestTouchPosition(row: HTMLElement, requested: number) {
  let best = requested
  let distance = VISUAL_SNAP_PX + 0.001

  for (const other of sameSideRows(row)) {
    const otherOffset = rowCurrentDisplayOffset(other)
    if (otherOffset == null) continue
    const spacing = minimumSpacing(row, other)
    for (const candidate of [otherOffset - spacing, otherOffset + spacing]) {
      const candidateDistance = Math.abs(requested - candidate)
      if (candidateDistance < distance) {
        best = candidate
        distance = candidateDistance
      }
    }
  }

  return distance <= VISUAL_SNAP_PX ? best : requested
}

function avoidVisualOverlap(row: HTMLElement, requested: number, physicalDelta: number) {
  let candidate = requested
  const others = sameSideRows(row)
  const movingUp = physicalDelta < 0

  for (let pass = 0; pass < others.length + 2; pass += 1) {
    let changed = false
    for (const other of others) {
      const otherOffset = rowCurrentDisplayOffset(other)
      if (otherOffset == null) continue
      const spacing = minimumSpacing(row, other)
      if (Math.abs(candidate - otherOffset) >= spacing - 0.25) continue

      // When approaching a strip from below/upward, stop directly below it. When
      // approaching from above/downward, stop directly above it. Reordering itself
      // is still handled by the real TLDT drag/cascade path.
      candidate = movingUp ? otherOffset + spacing : otherOffset - spacing
      changed = true
    }
    if (!changed) break
  }
  return candidate
}

function compactDropPosition(row: HTMLElement, requested: number, physicalDelta: number) {
  return avoidVisualOverlap(row, nearestTouchPosition(row, requested), physicalDelta)
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

  // Normal drag always continues to drive the original TLDT/sequence logic. If the
  // target later gets held apart by SEP/cascade, the pointer's extra travel is kept as
  // a presentation-only residual so the controller can visually join the strips.
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    const key = rowKey(row)
    const ideal = rowIdealDisplayOffset(row)
    const displayed = rowCurrentDisplayOffset(row)
    if (!key || ideal == null || displayed == null) return

    drag = {
      row,
      key,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startDisplayOffsetPx: displayed,
      lastDisplayOffsetPx: displayed,
      lastPhysicalDeltaPx: 0,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return

    const physicalDelta = event.clientY - drag.startClientY
    const logicalDelta = physicalDelta * TIMELINE_LOGICAL_PX_PER_MINUTE / TIMELINE_DISPLAY_PX_PER_MINUTE
    const logicalClientY = drag.startClientY + logicalDelta
    const ideal = rowIdealDisplayOffset(drag.row) ?? drag.startDisplayOffsetPx
    const pointerDisplay = drag.startDisplayOffsetPx + physicalDelta

    drag.lastDisplayOffsetPx = pointerDisplay
    drag.lastPhysicalDeltaPx = physicalDelta
    setDisplayOffset(drag.row, pointerDisplay, ideal)

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    props.onPointerMove(fakePointer(drag.row, event.pointerId, logicalClientY))
  }

  const finishDrag = (event?: PointerEvent) => {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    const finished = drag
    drag = null

    // React/cascade completes on pointer-up. Read the resulting real TLDT position only
    // after that render, then preserve only the part of the pointer movement that the
    // real timeline could not follow because of separation/cascade constraints.
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        if (disposed) return
        const row = findRow(finished.key)
        if (!row) {
          visualResidualByKey.delete(finished.key)
          return
        }
        const ideal = rowIdealDisplayOffset(row)
        if (ideal == null) return

        const desired = compactDropPosition(row, finished.lastDisplayOffsetPx, finished.lastPhysicalDeltaPx)
        const residual = desired - ideal
        if (Math.abs(residual) <= RESIDUAL_TOLERANCE_PX) visualResidualByKey.delete(finished.key)
        else visualResidualByKey.set(finished.key, residual)

        setDisplayOffset(row, ideal + (visualResidualByKey.get(finished.key) ?? 0), ideal)
        applyStoredVisualPositions(row)
      })
    }, 0)
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
    visualResidualByKey.clear()
    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      row.style.removeProperty('--display-offset-px')
      row.style.removeProperty('--ideal-display-offset-px')
      delete row.dataset.timelinePacked
      delete row.dataset.visualCompact
      delete row.dataset.visualStripMoved
      delete row.dataset.visualDragging
    })
  }
}
