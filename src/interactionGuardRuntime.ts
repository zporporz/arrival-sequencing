import {
  TIMELINE_DISPLAY_PX_PER_MINUTE,
  TIMELINE_LOGICAL_PX_PER_MINUTE,
} from './timelineScale'

type ReactRowProps = {
  onPointerMove?: (event: FakePointerEvent) => void
  onDoubleClick?: () => void
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

type DragGuard = {
  row: HTMLElement
  pointerId: number
  startY: number
  startTldtMs: number
  earliestTargetMs: number
  moved: boolean
  wasManual: boolean
}

const MAX_MANUAL_GAIN_MINUTES = 5
const CLICK_MOVE_TOLERANCE_PX = 3

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function currentTargetMs(row: HTMLElement) {
  // --offset-px is still React's historical 10 px/min logical coordinate.
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return Date.now() - offsetPx / TIMELINE_LOGICAL_PX_PER_MINUTE * 60_000
  return null
}

function delayMinutes(row: HTMLElement) {
  const value = Number.parseFloat(row.children.item(5)?.textContent?.trim() || '')
  return Number.isFinite(value) ? value : 0
}

function rowIdentity(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  return airport && callsign ? { airport, callsign, key: `${airport}:${callsign}` } : null
}

function findRow(airport: string, callsign: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((row) => {
    const identity = rowIdentity(row)
    return identity?.airport === airport && identity.callsign === callsign
  }) ?? null
}

function fakePointer(pointerId: number, clientY: number, row: HTMLElement): FakePointerEvent {
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

async function clearSharedTarget(airport: string, callsign: string) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      action: 'clearManualTarget',
      serviceDate: new Date().toISOString().slice(0, 10),
      airport,
      callsign,
    }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Shared AMAN API returned ${response.status}`)
}

export function installInteractionGuardRuntime() {
  let drag: DragGuard | null = null
  const resetPending = new Set<string>()

  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    const startTldtMs = currentTargetMs(row)
    if (startTldtMs == null) return

    const naturalLandingMs = startTldtMs - delayMinutes(row) * 60_000
    drag = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTldtMs,
      earliestTargetMs: naturalLandingMs - MAX_MANUAL_GAIN_MINUTES * 60_000,
      moved: false,
      wasManual: row.classList.contains('is-stable') || row.dataset.targetMode === 'MANUAL',
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (Math.abs(event.clientY - drag.startY) > CLICK_MOVE_TOLERANCE_PX) drag.moved = true

    // Pointer travel is now measured against the 20 px/min display scale.
    const requestedMs = drag.startTldtMs + (-(event.clientY - drag.startY) / TIMELINE_DISPLAY_PX_PER_MINUTE) * 60_000
    if (requestedMs >= drag.earliestTargetMs) {
      delete drag.row.dataset.gainLimit
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return

    // Direct React callback still expects the 10 px/min logical coordinate.
    const limitedDeltaMinutes = (drag.earliestTargetMs - drag.startTldtMs) / 60_000
    const limitedClientY = drag.startY - limitedDeltaMinutes * TIMELINE_LOGICAL_PX_PER_MINUTE
    drag.row.dataset.gainLimit = `${MAX_MANUAL_GAIN_MINUTES} MIN MAX GAIN`
    drag.row.title = `${drag.row.title.replace(/ · MAX GAIN .*$/i, '')} · MAX GAIN ${MAX_MANUAL_GAIN_MINUTES} MIN`
    props.onPointerMove(fakePointer(event.pointerId, limitedClientY, drag.row))
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const snapshot = drag
    delete snapshot.row.dataset.gainLimit
    drag = null

    if (snapshot.moved) return
    event.stopImmediatePropagation()

    if (!snapshot.wasManual) {
      window.requestAnimationFrame(() => {
        reactProps<ReactRowProps>(snapshot.row)?.onDoubleClick?.()
      })
    }
  }

  const clearDrag = () => {
    if (drag) delete drag.row.dataset.gainLimit
    drag = null
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('select')) return
    if (event.target.closest('.aman-flight-row > b')) return

    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    if (!identity) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    if (resetPending.has(identity.key)) return
    resetPending.add(identity.key)

    const oldSharedRevision = row.dataset.sharedRevision
    row.dataset.resetPending = 'true'
    reactProps<ReactRowProps>(row)?.onDoubleClick?.()

    window.requestAnimationFrame(() => {
      const current = findRow(identity.airport, identity.callsign)
      if (!current) return
      current.dataset.resetPending = 'true'
      if (oldSharedRevision) current.dataset.sharedRevision = oldSharedRevision
    })

    void clearSharedTarget(identity.airport, identity.callsign)
      .then(() => {
        const current = findRow(identity.airport, identity.callsign)
        if (current) reactProps<ReactRowProps>(current)?.onDoubleClick?.()
      })
      .catch((error) => {
        const current = findRow(identity.airport, identity.callsign) || row
        current.title = `${current.title} · RETURN TO AUTO FAILED: ${error instanceof Error ? error.message : String(error)}`
      })
      .finally(() => {
        window.setTimeout(() => {
          resetPending.delete(identity.key)
          const current = findRow(identity.airport, identity.callsign)
          if (current) delete current.dataset.resetPending
        }, 250)
      })
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', clearDrag, true)
  document.addEventListener('dblclick', onDoubleClick, true)

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', clearDrag, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
  }
}
