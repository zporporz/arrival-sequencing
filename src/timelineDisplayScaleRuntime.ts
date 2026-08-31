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
  startIdealDisplayOffsetPx: number
  lastDisplayOffsetPx: number
}

type ReorderDetail = {
  identities?: string[]
}

export type TimelinePackItem = {
  key: string
  idealOffsetPx: number
}

export function packTimelineDisplayOffsets(items: TimelinePackItem[], minimumGapPx: number) {
  const gap = Math.max(0, minimumGapPx)
  const ordered = [...items].sort((a, b) => a.idealOffsetPx - b.idealOffsetPx || a.key.localeCompare(b.key))
  const packed = new Map<string, number>()
  let previous: number | null = null
  for (const item of ordered) {
    const display: number = previous == null ? item.idealOffsetPx : Math.max(item.idealOffsetPx, previous + gap)
    packed.set(item.key, display)
    previous = display
  }
  return packed
}

// Visual offsets keep close cross-runway strips readable without changing TLDT.
// Drag handoff also uses the same map briefly so a released strip never flashes.
const visualResidualByKey = new Map<string, number>()
const releaseHoldKeys = new Set<string>()

export function dragVisualCommitReady(
  startIdealDisplayOffsetPx: number,
  currentIdealDisplayOffsetPx: number,
  startDisplayOffsetPx: number,
  releasedDisplayOffsetPx: number,
) {
  const moved = Math.abs(releasedDisplayOffsetPx - startDisplayOffsetPx) >= 0.5
  return !moved || Math.abs(currentIdealDisplayOffsetPx - startIdealDisplayOffsetPx) >= 0.25
}

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

function applyStoredVisualPositions(exceptRow?: HTMLElement | null) {
  const activeKeys = new Set<string>()
  const groups = new Map<string, Array<{ row: HTMLElement; key: string; idealOffsetPx: number; height: number }>>()
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const key = rowKey(row)
    const ideal = rowIdealDisplayOffset(row)
    if (!key || ideal == null) return
    activeKeys.add(key)
    const side = row.dataset.displaySide === 'LEFT' || row.classList.contains('display-left') ? 'LEFT' : 'RIGHT'
    const bucket = groups.get(side) ?? []
    const rectHeight = row.getBoundingClientRect().height
    bucket.push({ row, key, idealOffsetPx: ideal, height: rectHeight > 0 ? rectHeight : 12 })
    groups.set(side, bucket)
  })

  for (const rows of groups.values()) {
    const minimumGap = Math.max(12, ...rows.map((item) => Math.ceil(item.height)))
    const packed = packTimelineDisplayOffsets(rows, minimumGap)
    for (const item of rows) {
      const display = packed.get(item.key) ?? item.idealOffsetPx
      visualResidualByKey.set(item.key, display - item.idealOffsetPx)
      if (item.row === exceptRow || releaseHoldKeys.has(item.key)) continue
      setDisplayOffset(item.row, display, item.idealOffsetPx)
    }
  }

  for (const key of visualResidualByKey.keys()) {
    if (!activeKeys.has(key)) visualResidualByKey.delete(key)
  }
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
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (disposed) return
      // During a live drag, keep the dragged strip under the pointer but immediately
      // move every cascaded follower to its newly constrained TLDT position.
      applyStoredVisualPositions(drag?.row ?? null)
    })
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    const key = rowKey(row)
    const ideal = rowIdealDisplayOffset(row)
    const displayed = rowCurrentDisplayOffset(row)
    if (!key || ideal == null || displayed == null) return

    releaseHoldKeys.delete(key)

    drag = {
      row,
      key,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startDisplayOffsetPx: displayed,
      startIdealDisplayOffsetPx: ideal,
      lastDisplayOffsetPx: displayed,
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
    releaseHoldKeys.add(finished.key)
    setDisplayOffset(finished.row, finished.lastDisplayOffsetPx, finished.startIdealDisplayOffsetPx)

    // React receives pointer moves through a native capture listener. Its final state
    // can therefore land one frame after pointerup. Keep the strip at the release
    // position until --offset-px reflects that commit; otherwise it flashes at the
    // old TLDT for one frame before jumping to the new one.
    const deadline = performance.now() + 300
    const completeVisualHandoff = () => {
      if (disposed) return
      // A rapid second drag owns the visual position now; an older release must not
      // overwrite it when its delayed handoff callback runs.
      if (drag?.key === finished.key) return
      const row = findRow(finished.key)
      if (!row) {
        releaseHoldKeys.delete(finished.key)
        visualResidualByKey.delete(finished.key)
        return
      }
      const ideal = rowIdealDisplayOffset(row)
      if (ideal == null) return
      const ready = dragVisualCommitReady(
        finished.startIdealDisplayOffsetPx,
        ideal,
        finished.startDisplayOffsetPx,
        finished.lastDisplayOffsetPx,
      )
      if (!ready && performance.now() < deadline) {
        setDisplayOffset(row, finished.lastDisplayOffsetPx, ideal)
        window.requestAnimationFrame(completeVisualHandoff)
        return
      }

      releaseHoldKeys.delete(finished.key)
      visualResidualByKey.delete(finished.key)
      setDisplayOffset(row, ideal, ideal)
      applyStoredVisualPositions(row)
    }
    window.requestAnimationFrame(completeVisualHandoff)
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    releaseHoldKeys.delete(rowKey(row))

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
    releaseHoldKeys.clear()
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
