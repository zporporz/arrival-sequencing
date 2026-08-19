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
}

const PX_PER_MINUTE = 10
const MAX_MANUAL_GAIN_MINUTES = 5

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function currentTargetMs(row: HTMLElement) {
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return Date.now() - offsetPx / PX_PER_MINUTE * 60_000
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
  return airport && callsign ? { airport, callsign } : null
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

    // Delay Required = TLDT - natural landing prediction, so this reconstructs
    // the current natural landing time without coupling the limit to a manual target.
    const naturalLandingMs = startTldtMs - delayMinutes(row) * 60_000
    drag = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      startTldtMs,
      earliestTargetMs: naturalLandingMs - MAX_MANUAL_GAIN_MINUTES * 60_000,
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const requestedMs = drag.startTldtMs + (-(event.clientY - drag.startY) / PX_PER_MINUTE) * 60_000

    if (requestedMs >= drag.earliestTargetMs) {
      delete drag.row.dataset.gainLimit
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const props = reactProps<ReactRowProps>(drag.row)
    if (!props?.onPointerMove) return

    const limitedDeltaMinutes = (drag.earliestTargetMs - drag.startTldtMs) / 60_000
    const limitedClientY = drag.startY - limitedDeltaMinutes * PX_PER_MINUTE
    drag.row.dataset.gainLimit = `${MAX_MANUAL_GAIN_MINUTES} MIN MAX GAIN`
    drag.row.title = `${drag.row.title.replace(/ · MAX GAIN .*$/i, '')} · MAX GAIN ${MAX_MANUAL_GAIN_MINUTES} MIN`
    props.onPointerMove(fakePointer(event.pointerId, limitedClientY, drag.row))
  }

  const clearDrag = () => {
    if (drag) delete drag.row.dataset.gainLimit
    drag = null
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('select')) return

    // Delay Required has its own HOLD / NO HOLD double-click interaction.
    if (event.target.closest('.aman-flight-row > b')) return

    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    if (!identity) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const key = `${identity.airport}:${identity.callsign}`
    if (resetPending.has(key)) return
    resetPending.add(key)
    row.dataset.resetPending = 'true'

    // Server first, local React second. This prevents the old shared MANUAL target
    // from being re-applied for a frame between the local reset and the database ack.
    void clearSharedTarget(identity.airport, identity.callsign)
      .then(() => {
        reactProps<ReactRowProps>(row)?.onDoubleClick?.()
      })
      .catch((error) => {
        row.title = `${row.title} · RETURN TO AUTO FAILED: ${error instanceof Error ? error.message : String(error)}`
      })
      .finally(() => {
        resetPending.delete(key)
        delete row.dataset.resetPending
      })
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', clearDrag, true)
  document.addEventListener('pointercancel', clearDrag, true)
  document.addEventListener('dblclick', onDoubleClick, true)

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', clearDrag, true)
    document.removeEventListener('pointercancel', clearDrag, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
  }
}
