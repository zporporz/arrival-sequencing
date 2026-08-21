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

type ReorderDetail = {
  identities?: string[]
}

const FALLBACK_ROW_HEIGHT_PX = 18
const RESIDUAL_TOLERANCE_PX = 3
const MIN_VISUAL_GAP_PX = 0

// Presentation-only offset used only after the real TLDT has been constrained by
// separation/cascade. The real sequence time never reads this value.
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

function rowIsManual(row: HTMLElement) {
  return row.classList.contains('is-stable')
    || row.dataset.targetMode === 'MANUAL'
    || row.querySelector('.runway-assignment.is-manual') != null
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

function resetRowVisual(row: HTMLElement) {
  const key = rowKey(row)
  if (key) visualResidualByKey.delete(key)
  const ideal = rowIdealDisplayOffset(row)
  if (ideal != null) setDisplayOffset(row, ideal, ideal)
}

function findRow(key: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((row) => rowKey(row) === key) ?? null
}

function orderedSideRows(row: HTMLElement) {
  const side = rowDisplaySide(row)
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row'))
    .filter((candidate) => rowDisplaySide(candidate) === side && rowIdealDisplayOffset(candidate) != null)
    .sort((left, right) => (rowIdealDisplayOffset(left) ?? 0) - (rowIdealDisplayOffset(right) ?? 0))
}

function adjacentRows(row: HTMLElement) {
  const ordered = orderedSideRows(row)
  const index = ordered.indexOf(row)
  return {
    before: index > 0 ? ordered[index - 1] : null,
    after: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  }
}

function applyStoredVisualPositions(exceptRow?: HTMLElement | null) {
  const activeKeys = new Set<string>()
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const key = rowKey(row)
    const ideal = rowIdealDisplayOffset(row)
    if (!key || ideal == null) return
    activeKeys.add(key)

    // Returning a flight to AUTO must also return its strip to the true timeline
    // position. A presentation-only close-gap offset must never survive AUTO reset.
    if (!rowIsManual(row) && visualResidualByKey.has(key)) {
      visualResidualByKey.delete(key)
    }

    if (row === exceptRow) return
    setDisplayOffset(row, ideal + (visualResidualByKey.get(key) ?? 0), ideal)
  })

  for (const key of visualResidualByKey.keys()) {
    if (!activeKeys.has(key)) visualResidualByKey.delete(key)
  }
}

function clampToAdjacentBlock(row: HTMLElement, requested: number, physicalDelta: number) {
  const ideal = rowIdealDisplayOffset(row)
  if (ideal == null) return requested

  const { before, after } = adjacentRows(row)
  let minimum = Number.NEGATIVE_INFINITY
  let maximum = Number.POSITIVE_INFINITY

  if (before) {
    const offset = rowCurrentDisplayOffset(before)
    if (offset != null) minimum = offset + minimumSpacing(before, row)
  }
  if (after) {
    const offset = rowCurrentDisplayOffset(after)
    if (offset != null) maximum = offset - minimumSpacing(row, after)
  }

  const clamped = Math.min(maximum, Math.max(minimum, requested))
  if (minimum > maximum) return physicalDelta < 0 ? maximum : minimum
  return clamped
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
    // Shift+Drag belongs exclusively to the reorder runtime. Do not start the normal
    // target/compact drag here as well.
    if (event.shiftKey || event.button !== 0) return
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

        const desired = clampToAdjacentBlock(row, finished.lastDisplayOffsetPx, finished.lastPhysicalDeltaPx)
        const residual = desired - ideal
        if (Math.abs(residual) <= RESIDUAL_TOLERANCE_PX) visualResidualByKey.delete(finished.key)
        else visualResidualByKey.set(finished.key, residual)

        setDisplayOffset(row, ideal + (visualResidualByKey.get(finished.key) ?? 0), ideal)
        applyStoredVisualPositions(row)
      })
    }, 0)
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    // Let the normal reset handler clear the manual target. Independently clear the
    // presentation offset now and again after React renders the AUTO target.
    resetRowVisual(row)
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const current = findRow(rowKey(row))
        if (current) resetRowVisual(current)
        applyStoredVisualPositions()
      })
    }, 0)
  }

  const onSequenceReordered = (event: Event) => {
    const identities = (event as CustomEvent<ReorderDetail>).detail?.identities ?? []
    for (const key of identities) visualResidualByKey.delete(key)

    // Old close-gap offsets belong to the old sequence neighbours. Throw them away
    // before rendering the new order so a reordered strip cannot jump to an obsolete Y.
    window.setTimeout(() => {
      window.requestAnimationFrame(() => applyStoredVisualPositions())
    }, 0)
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', finishDrag, true)
  document.addEventListener('pointercancel', finishDrag, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  window.addEventListener('aman:sequence-reordered', onSequenceReordered)

  applyStoredVisualPositions()
  const observer = new MutationObserver(scheduleApply)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-display-side', 'data-target-mode'],
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
    document.removeEventListener('dblclick', onDoubleClick, true)
    window.removeEventListener('aman:sequence-reordered', onSequenceReordered)
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
