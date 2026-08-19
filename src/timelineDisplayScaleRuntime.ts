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
}

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function decorateRow(row: HTMLElement) {
  const logicalOffset = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (!Number.isFinite(logicalOffset)) return
  const displayOffset = Math.round(logicalOffset * TIMELINE_DISPLAY_SCALE * 100) / 100
  const next = `${displayOffset}px`
  if (row.style.getPropertyValue('--display-offset-px') !== next) {
    row.style.setProperty('--display-offset-px', next)
  }
}

function decorateRows() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(decorateRow)
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
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) decorateRows()
    })
  }

  // Existing interaction/reorder guards run on document capture before this runtime.
  // They see the real physical 20 px/min pointer distance. Once they have accepted the
  // movement, convert it back to the React application's historical 10 px/min coordinate
  // so its target-time arithmetic remains exact.
  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    drag = { row, pointerId: event.pointerId, startClientY: event.clientY }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return

    const physicalDelta = event.clientY - drag.startClientY
    const logicalDelta = physicalDelta * TIMELINE_LOGICAL_PX_PER_MINUTE / TIMELINE_DISPLAY_PX_PER_MINUTE
    const logicalClientY = drag.startClientY + logicalDelta

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
    attributeFilter: ['style'],
  })
  const timer = window.setInterval(decorateRows, 500)

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
    })
  }
}
