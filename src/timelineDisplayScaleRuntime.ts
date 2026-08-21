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

type TimelineItem = {
  row: HTMLElement
  idealOffsetPx: number
  heightPx: number
}

const LOCAL_DENSITY_WINDOW_MINUTES = 15
const LOCAL_DENSITY_WINDOW_PX = LOCAL_DENSITY_WINDOW_MINUTES * TIMELINE_DISPLAY_PX_PER_MINUTE
const DENSITY_START_ROWS = 5
const DENSITY_FULL_ROWS = 8
const MIN_VISUAL_GAP_PX = 2
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

function minimumSpacing(left: TimelineItem, right: TimelineItem) {
  return (left.heightPx + right.heightPx) / 2 + MIN_VISUAL_GAP_PX
}

function localCount(items: TimelineItem[], centrePx: number) {
  const halfWindow = LOCAL_DENSITY_WINDOW_PX / 2
  return items.reduce((count, item) => count + (Math.abs(item.idealOffsetPx - centrePx) <= halfWindow ? 1 : 0), 0)
}

function compressionPressure(count: number) {
  if (count < DENSITY_START_ROWS) return 0
  return clamp((count - (DENSITY_START_ROWS - 1)) / (DENSITY_FULL_ROWS - (DENSITY_START_ROWS - 1)), 0, 1)
}

function denseGroups(items: TimelineItem[]) {
  const dense = new Set<number>()
  const halfWindow = LOCAL_DENSITY_WINDOW_PX / 2

  items.forEach((item) => {
    const members: number[] = []
    items.forEach((candidate, candidateIndex) => {
      if (Math.abs(candidate.idealOffsetPx - item.idealOffsetPx) <= halfWindow) members.push(candidateIndex)
    })
    if (members.length >= DENSITY_START_ROWS) members.forEach((member) => dense.add(member))
  })

  const groups: number[][] = []
  let current: number[] = []
  for (let index = 0; index < items.length; index += 1) {
    if (!dense.has(index)) {
      if (current.length) groups.push(current)
      current = []
      continue
    }

    const previous = current.at(-1)
    if (previous != null && items[index].idealOffsetPx - items[previous].idealOffsetPx > LOCAL_DENSITY_WINDOW_PX) {
      groups.push(current)
      current = []
    }
    current.push(index)
  }
  if (current.length) groups.push(current)
  return groups
}

function packDenseGroup(items: TimelineItem[], indices: number[]) {
  if (indices.length < 2) return
  const group = indices.map((index) => items[index])
  const packed = [group[0].idealOffsetPx]

  for (let index = 1; index < group.length; index += 1) {
    const left = group[index - 1]
    const right = group[index]
    const idealGap = Math.max(0, right.idealOffsetPx - left.idealOffsetPx)
    const minimumGap = minimumSpacing(left, right)
    const midpoint = (left.idealOffsetPx + right.idealOffsetPx) / 2
    const pressure = compressionPressure(localCount(items, midpoint))
    const nextGap = idealGap <= minimumGap
      ? minimumGap
      : minimumGap + (idealGap - minimumGap) * (1 - pressure)
    packed.push(packed[index - 1] + nextGap)
  }

  const meanIdeal = group.reduce((sum, item) => sum + item.idealOffsetPx, 0) / group.length
  const meanPacked = packed.reduce((sum, value) => sum + value, 0) / packed.length
  let correction = meanIdeal - meanPacked

  const firstIndex = indices[0]
  const lastIndex = indices[indices.length - 1]
  const previous = firstIndex > 0 ? items[firstIndex - 1] : null
  const next = lastIndex < items.length - 1 ? items[lastIndex + 1] : null
  const minFirst = previous ? previous.idealOffsetPx + minimumSpacing(previous, group[0]) : Number.NEGATIVE_INFINITY
  const maxLast = next ? next.idealOffsetPx - minimumSpacing(group[group.length - 1], next) : Number.POSITIVE_INFINITY

  if (packed[0] + correction < minFirst) correction += minFirst - (packed[0] + correction)
  if (packed[packed.length - 1] + correction > maxLast) correction += maxLast - (packed[packed.length - 1] + correction)

  group.forEach((item, index) => setDisplayOffset(item.row, packed[index] + correction, item.idealOffsetPx))
}

function packSide(rows: HTMLElement[]) {
  const items = rows
    .map((row) => {
      const idealOffsetPx = rowIdealDisplayOffset(row)
      return idealOffsetPx == null ? null : { row, idealOffsetPx, heightPx: rowHeightPx(row) }
    })
    .filter((item): item is TimelineItem => item !== null)
    .sort((left, right) => left.idealOffsetPx - right.idealOffsetPx)

  items.forEach((item) => setDisplayOffset(item.row, item.idealOffsetPx, item.idealOffsetPx))
  denseGroups(items).forEach((group) => packDenseGroup(items, group))
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
