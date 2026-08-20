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
  pointerId: number
  startClientY: number
  startDisplayOffsetPx: number
}

type PackedItem = {
  row: HTMLElement
  idealOffsetPx: number
  heightPx: number
}

// With only a few strips, keep them on their true time positions. As traffic
// builds, progressively compress only the spare visual gap between neighbouring
// strips. This is intentionally load-driven rather than a fixed "5 minute cluster".
const DENSITY_FREE_ROWS = 4
const DENSITY_FULL_PACK_ROWS = 12
const PACK_MIN_VISUAL_GAP_PX = 2
const PACK_PROXIMITY_MULTIPLIER = 3
const FALLBACK_ROW_HEIGHT_PX = 18

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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

function rowDisplaySide(row: HTMLElement) {
  return row.dataset.displaySide === 'LEFT' || row.classList.contains('display-left') ? 'LEFT' : 'RIGHT'
}

function rowHeightPx(row: HTMLElement) {
  const measured = row.getBoundingClientRect().height
  return Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_ROW_HEIGHT_PX
}

function setDisplayOffset(row: HTMLElement, displayOffsetPx: number, idealOffsetPx: number) {
  const display = `${Math.round(displayOffsetPx * 100) / 100}px`
  const ideal = `${Math.round(idealOffsetPx * 100) / 100}px`
  if (row.style.getPropertyValue('--display-offset-px') !== display) row.style.setProperty('--display-offset-px', display)
  if (row.style.getPropertyValue('--ideal-display-offset-px') !== ideal) row.style.setProperty('--ideal-display-offset-px', ideal)
  row.dataset.timelinePacked = Math.abs(displayOffsetPx - idealOffsetPx) >= 0.5 ? 'true' : 'false'
}

function requiredVisualSpacing(left: PackedItem, right: PackedItem) {
  return (left.heightPx + right.heightPx) / 2 + PACK_MIN_VISUAL_GAP_PX
}

function densityPressure(rowCount: number) {
  return clamp(
    (rowCount - DENSITY_FREE_ROWS) / Math.max(1, DENSITY_FULL_PACK_ROWS - DENSITY_FREE_ROWS),
    0,
    1,
  )
}

function elasticGap(left: PackedItem, right: PackedItem, pressure: number) {
  const idealGap = Math.max(0, right.idealOffsetPx - left.idealOffsetPx)
  const minimumGap = requiredVisualSpacing(left, right)

  // Rows that would overlap are always separated enough to remain readable.
  if (idealGap <= minimumGap) return minimumGap
  if (pressure <= 0) return idealGap

  // Dense traffic should look like a compact MAESTRO strip list, while genuinely
  // large time gaps should still remain visually obvious. Nearby gaps therefore
  // compress much harder than large gaps as the number of displayed flights grows.
  const proximity = clamp((minimumGap * PACK_PROXIMITY_MULTIPLIER) / idealGap, 0, 1)
  const compression = pressure * proximity
  return minimumGap + (idealGap - minimumGap) * (1 - compression)
}

function packSide(rows: HTMLElement[]) {
  const items = rows
    .map((row) => {
      const idealOffsetPx = rowIdealDisplayOffset(row)
      return idealOffsetPx == null ? null : {
        row,
        idealOffsetPx,
        heightPx: rowHeightPx(row),
      }
    })
    .filter((item): item is PackedItem => item !== null)
    .sort((left, right) => left.idealOffsetPx - right.idealOffsetPx)

  if (!items.length) return

  const pressure = densityPressure(items.length)
  if (pressure <= 0 && items.every((item, index) => {
    if (index === 0) return true
    return item.idealOffsetPx - items[index - 1].idealOffsetPx >= requiredVisualSpacing(items[index - 1], item)
  })) {
    items.forEach((item) => setDisplayOffset(item.row, item.idealOffsetPx, item.idealOffsetPx))
    return
  }

  const packedOffsets = [items[0].idealOffsetPx]
  for (let index = 1; index < items.length; index += 1) {
    packedOffsets.push(packedOffsets[index - 1] + elasticGap(items[index - 1], items[index], pressure))
  }

  // Keep the packed strip stack centred on its true time positions instead of
  // allowing all compression to accumulate toward only one end of the timeline.
  const meanIdeal = items.reduce((sum, item) => sum + item.idealOffsetPx, 0) / items.length
  const meanPacked = packedOffsets.reduce((sum, value) => sum + value, 0) / packedOffsets.length
  const centreCorrection = meanIdeal - meanPacked

  items.forEach((item, index) => {
    setDisplayOffset(item.row, packedOffsets[index] + centreCorrection, item.idealOffsetPx)
  })
}

function decorateRows() {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row'))
  packSide(rows.filter((row) => rowDisplaySide(row) === 'LEFT'))
  packSide(rows.filter((row) => rowDisplaySide(row) === 'RIGHT'))
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

  const scheduleDecorate = () => {
    if (disposed || scheduled || drag) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed && !drag) decorateRows()
    })
  }

  // Existing interaction/reorder guards run on document capture before this runtime.
  // They see the real physical pointer distance. This adapter converts that movement
  // back to React's historical 10 px/min target-time math. Visual strip packing is
  // presentation-only and never changes the underlying TLDT/STA timestamp.
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    const displayed = Number.parseFloat(row.style.getPropertyValue('--display-offset-px'))
    const ideal = rowIdealDisplayOffset(row)
    drag = {
      row,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startDisplayOffsetPx: Number.isFinite(displayed) ? displayed : (ideal ?? 0),
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return

    const physicalDelta = event.clientY - drag.startClientY
    const logicalDelta = physicalDelta * TIMELINE_LOGICAL_PX_PER_MINUTE / TIMELINE_DISPLAY_PX_PER_MINUTE
    const logicalClientY = drag.startClientY + logicalDelta

    // Follow the pointer from the packed strip position while dragging. On release
    // the whole side is packed again around the newly selected exact target time.
    const ideal = rowIdealDisplayOffset(drag.row) ?? drag.startDisplayOffsetPx
    setDisplayOffset(drag.row, drag.startDisplayOffsetPx + physicalDelta, ideal)

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    props.onPointerMove(fakePointer(drag.row, event.pointerId, logicalClientY))
  }

  const clearDrag = (event?: PointerEvent) => {
    if (event && drag && event.pointerId !== drag.pointerId) return
    drag = null
    scheduleDecorate()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', clearDrag, true)
  document.addEventListener('pointercancel', clearDrag, true)

  decorateRows()
  const observer = new MutationObserver(scheduleDecorate)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'data-display-side'],
  })
  const timer = window.setInterval(scheduleDecorate, 500)

  return () => {
    disposed = true
    drag = null
    observer.disconnect()
    window.clearInterval(timer)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', clearDrag, true)
    document.removeEventListener('pointercancel', clearDrag, true)
    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      row.style.removeProperty('--display-offset-px')
      row.style.removeProperty('--ideal-display-offset-px')
      delete row.dataset.timelinePacked
    })
  }
}
