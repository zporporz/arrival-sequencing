type ReactRowProps = {
  onDoubleClick?: () => void
}

type AutoReturnDetail = {
  airport?: string
  runway?: string
  identity?: string
  autoTldt?: string
  autoFloorTldt?: string
}

type DragGuard = {
  row: HTMLElement
  pointerId: number
  startY: number
  moved: boolean
  wasManual: boolean
}

const CLICK_MOVE_TOLERANCE_PX = 3

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
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

function clearLegacyGainLimit(row: HTMLElement) {
  delete row.dataset.gainLimit
  row.title = row.title.replace(/ · MAX GAIN .*$/i, '')
}

async function clearSharedTarget(airport: string, callsign: string, autoTldt: string, autoFloorTldt: string, autoRunway: string) {
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
      autoTldt,
      autoFloorTldt,
      autoRunway,
    }),
  })
  const payload = await response.json() as { error?: string; flightState?: unknown }
  if (!response.ok) throw new Error(payload.error || `Shared AMAN API returned ${response.status}`)
  return payload.flightState ?? null
}

export function installInteractionGuardRuntime() {
  let drag: DragGuard | null = null
  const resetPending = new Set<string>()
  const currentAutoReturns = new Map<string, { autoTldt: string; autoFloorTldt: string; autoRunway: string }>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(clearLegacyGainLimit)

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return

    clearLegacyGainLimit(row)
    drag = {
      row,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
      wasManual: row.classList.contains('is-stable') || row.dataset.targetMode === 'MANUAL',
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (Math.abs(event.clientY - drag.startY) > CLICK_MOVE_TOLERANCE_PX) drag.moved = true
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const snapshot = drag
    clearLegacyGainLimit(snapshot.row)
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
    if (drag) clearLegacyGainLimit(drag.row)
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
    const currentAuto = currentAutoReturns.get(identity.key)
    currentAutoReturns.delete(identity.key)

    window.requestAnimationFrame(() => {
      const current = findRow(identity.airport, identity.callsign)
      if (!current) return
      current.dataset.resetPending = 'true'
      if (oldSharedRevision) current.dataset.sharedRevision = oldSharedRevision
    })

    const clearRequest = currentAuto
      ? clearSharedTarget(identity.airport, identity.callsign, currentAuto.autoTldt, currentAuto.autoFloorTldt, currentAuto.autoRunway)
      : Promise.reject(new Error('Current AUTO target was not calculated'))

    void clearRequest
      .then((flightState) => {
        if (!flightState) return
        // The capture-phase interaction guard owns this dblclick, so the shared
        // runtime's bubble listener never sees it. Publish the authoritative row
        // returned by Supabase immediately instead of waiting for the 5 s poll.
        window.dispatchEvent(new CustomEvent('aman:realtime-flight-state', { detail: flightState }))
        window.dispatchEvent(new CustomEvent('aman:realtime-commit-request', {
          detail: { airport: identity.airport, flightState },
        }))
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

  const onReturnFlightAuto = (event: Event) => {
    const detail = (event as CustomEvent<AutoReturnDetail>).detail
    const airport = String(detail?.airport || '').trim().toUpperCase()
    const identity = String(detail?.identity || '').trim().toUpperCase()
    const autoRunway = String(detail?.runway || '').trim().toUpperCase()
    const autoTldt = String(detail?.autoTldt || '')
    const autoFloorTldt = String(detail?.autoFloorTldt || '')
    const autoMs = new Date(autoTldt).getTime()
    const floorMs = new Date(autoFloorTldt).getTime()
    if (!airport || !identity || !autoRunway || !Number.isFinite(autoMs) || !Number.isFinite(floorMs)) return
    currentAutoReturns.set(identity, {
      autoTldt: new Date(autoMs).toISOString(),
      autoFloorTldt: new Date(floorMs).toISOString(),
      autoRunway,
    })
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', clearDrag, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  window.addEventListener('aman:return-flight-auto', onReturnFlightAuto)

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', clearDrag, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
    window.removeEventListener('aman:return-flight-auto', onReturnFlightAuto)
    currentAutoReturns.clear()
  }
}
