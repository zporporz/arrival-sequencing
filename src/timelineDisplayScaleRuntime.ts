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
}

const PACK_CLUSTER_WINDOW_MINUTES = 5
const PACK_ROW_STEP_PX = 20
const PACK_GROUP_GAP_PX = 8

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

function setDisplayOffset(row: HTMLElement, displayOffsetPx: number, idealOffsetPx: number) {
  const display = `${Math.round(displayOffsetPx * 100) / 100}px`
  const ideal = `${Math.round(idealOffsetPx * 100) / 100}px`
  if (row.style.getPropertyValue('--display-offset-px') !== display) row.style.setProperty('--display-offset-px', display)
  if (row.style.getPropertyValue('--ideal-display-offset-px') !== ideal) row.style.setProperty('--ideal-display-offset-px', ideal)
  row.dataset.timelinePacked = Math.abs(displayOffsetPx - idealOffsetPx) >= 0.5 ? 'true' : 'false'
}

function splitIntoClusters(items: PackedItem[]) {
  const clusters: PackedItem[][] = []
  const clusterWindowPx = PACK_CLUSTER_WINDOW_MINUTES * TIMELINE_DISPLAY_PX_PER_MINUTE

  for (const item of items) {
    const current = clusters.at(-1)
    const previous = current?.at(-1)
    if (!current || !previous || item.idealOffsetPx - previous.idealOffsetPx > clusterWindowPx) {
      clusters.push([item])
    } else {
      current.push(item)
    }
  }
  return clusters
}

function packSide(rows: HTMLElement[]) {
  const items = rows
    .map((row) => {
      const idealOffsetPx = rowIdealDisplayOffset(row)
      return idealOffsetPx == null ? null : { row, idealOffsetPx }
    })
    .filter((item): item is PackedItem => item !== null)
    .sort((left, right) => left.idealOffsetPx - right.idealOffsetPx)

  const clusters = splitIntoClusters(items)
  let previousGroupEnd = Number.NEGATIVE_INFINITY

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const item = cluster[0]
      const displayOffsetPx = Math.max(item.idealOffsetPx, previousGroupEnd + PACK_GROUP_GAP_PX)
      setDisplayOffset(item.row, displayOffsetPx, item.idealOffsetPx)
      previousGroupEnd = displayOffsetPx
      continue
    }

    // Real MAESTRO keeps dense traffic strips readable instead of forcing every
    // callsign to sit exactly on its minute tick. Keep the cluster centred around
    // its true time band, but pack labels one strip-height apart. Exact TLDT remains
    // in the row text/title and in --ideal-display-offset-px.
    const meanIdeal = cluster.reduce((sum, item) => sum + item.idealOffsetPx, 0) / cluster.length
    const packedHeight = (cluster.length - 1) * PACK_ROW_STEP_PX
    let groupStart = meanIdeal - packedHeight / 2
    if (groupStart < previousGroupEnd + PACK_GROUP_GAP_PX) {
      groupStart = previousGroupEnd + PACK_GROUP_GAP_PX
    }

    cluster.forEach((item, index) => {
      const displayOffsetPx = groupStart + index * PACK_ROW_STEP_PX
      setDisplayOffset(item.row, displayOffsetPx, item.idealOffsetPx)
    })
    previousGroupEnd = groupStart + packedHeight
  }
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
