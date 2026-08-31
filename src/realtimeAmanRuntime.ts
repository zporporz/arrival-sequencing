type CanonicalArrival = { id: string; predictedIawpAt: string }
type LocalAutoSnapshotDetail = { predictions?: CanonicalArrival[] }
type RealtimeCommitDetail = { airport?: string; flightState?: unknown; sequenceOrder?: unknown }
type FinishedDrag = {
  airport: string
  callsign: string
  previewId: string
  lastSentAt: number
  pointerId: number
  row: HTMLElement
}

const AIRPORTS = ['VTBD', 'VTBS'] as const
const PX_PER_MINUTE = 10
const PREVIEW_INTERVAL_MS = 80
const AUTO_SNAPSHOT_MAX_AGE_MS = 60_000

export function realtimeReconnectDelayMs(attempt: number) {
  return Math.min(15_000, 500 * 2 ** Math.max(0, Math.min(5, attempt)))
}

export function canonicalSnapshotIsFresh(updatedAt: unknown, nowMs = Date.now()) {
  const value = new Date(String(updatedAt ?? '')).getTime()
  return Number.isFinite(value) && Math.abs(nowMs - value) <= AUTO_SNAPSHOT_MAX_AGE_MS
}

export function realtimeUtcServiceDate(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export function millisecondsUntilNextUtcServiceDate(nowMs = Date.now()) {
  const now = new Date(nowMs)
  const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return nextUtcMidnight - nowMs
}

function rowInfo(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  const runway = row.querySelector<HTMLSelectElement>('.runway-assignment select')?.value
    || row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().replace(/^(?:BD|BS)\//, '')
    || ''
  return airport && callsign ? { airport, callsign, runway: runway.toUpperCase() } : null
}

function targetMs(row: HTMLElement) {
  const offset = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  return Number.isFinite(offset) ? Date.now() - offset / PX_PER_MINUTE * 60_000 : null
}

function formatHms(valueMs: number) {
  const value = new Date(valueMs)
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}:${String(value.getUTCSeconds()).padStart(2, '0')}`
}

export function installRealtimeAmanRuntime() {
  type Room = {
    airport: string
    socket: WebSocket | null
    leader: boolean
    attempt: number
    reconnectTimer: number | null
    serviceDate: string
    latestLocal: CanonicalArrival[]
    status: 'CONNECTING' | 'LIVE' | 'DEGRADED'
  }

  const rooms = new Map<string, Room>()
  const previewOriginals = new Map<string, Map<HTMLElement, { offset: string; tldt: string }>>()
  const previewSubjects = new Map<string, string>()
  const previewCancelTimers = new Map<string, number>()
  const lockTimers = new Map<string, number>()
  let activeDrag: FinishedDrag | null = null
  let disposed = false
  let activeServiceDate = realtimeUtcServiceDate()
  let serviceDateTimer: number | null = null

  const renderHealth = () => {
    const list = document.querySelector<HTMLElement>('.aman-status-list')
    if (!list) return
    let row = list.querySelector<HTMLElement>('.aman-runtime-realtime-status')
    if (!row) {
      row = document.createElement('div')
      row.className = 'aman-runtime-realtime-status'
      const label = document.createElement('dt')
      label.textContent = 'Realtime sync'
      const value = document.createElement('dd')
      row.append(label, value)
      list.appendChild(row)
    }
    const live = [...rooms.values()].filter((room) => room.status === 'LIVE').length
    const value = row.querySelector<HTMLElement>('dd')
    if (!value) return
    value.textContent = live === AIRPORTS.length ? 'LIVE' : live ? `DEGRADED ${live}/${AIRPORTS.length}` : 'DEGRADED'
    value.classList.toggle('is-warning', live !== AIRPORTS.length)
  }

  const send = (airport: string, payload: unknown) => {
    const socket = rooms.get(airport)?.socket
    if (socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  const sendAutoSnapshot = (room: Room) => {
    if (!room.leader || !room.latestLocal.length) return
    send(room.airport, { type: 'auto_snapshot', arrivals: room.latestLocal })
  }

  const clearPreview = (previewId: string) => {
    const originals = previewOriginals.get(previewId)
    originals?.forEach((original, row) => {
      if (row.isConnected) {
        row.style.setProperty('--offset-px', original.offset)
        const label = row.querySelector<HTMLElement>('.tldt')
        if (label) label.textContent = original.tldt
        delete row.dataset.realtimePreview
      }
    })
    previewOriginals.delete(previewId)
    previewSubjects.delete(previewId)
  }

  const acceptPreview = (previewId: string) => {
    previewOriginals.get(previewId)?.forEach((_original, row) => {
      if (row.dataset.realtimePreview === previewId) delete row.dataset.realtimePreview
    })
    previewOriginals.delete(previewId)
    previewSubjects.delete(previewId)
  }

  const clearPreviewCancelTimer = (previewId: string) => {
    const timer = previewCancelTimers.get(previewId)
    if (timer != null) window.clearTimeout(timer)
    previewCancelTimers.delete(previewId)
  }

  const clearCommittedPreview = (message: { airport?: string; previewId?: string; flightState?: { callsign?: string } }) => {
    const previewId = String(message.previewId || '')
    if (previewId) {
      // The preview already shows the released position. Adopt it until React
      // applies the authoritative commit on the next animation frame; restoring
      // the pre-drag DOM here creates a visible one-frame jump.
      acceptPreview(previewId)
      clearPreviewCancelTimer(previewId)
      return
    }

    // Backward compatibility while an older worker version is still active:
    // only restore previews containing the committed flight, never every drag
    // that happens to be visible in this browser.
    const airport = String(message.airport || '').toUpperCase()
    const callsign = String(message.flightState?.callsign || '').toUpperCase()
    if (!airport || !callsign) return
    previewSubjects.forEach((subject, candidatePreviewId) => {
      if (subject !== `${airport}:${callsign}`) return
      acceptPreview(candidatePreviewId)
      clearPreviewCancelTimer(candidatePreviewId)
    })
  }

  const findRow = (airport: string, callsign: string) => Array.from(
    document.querySelectorAll<HTMLElement>('.aman-flight-row'),
  ).find((row) => {
    const info = rowInfo(row)
    return info?.airport === airport && info.callsign === callsign
  }) ?? null

  const showMessage = (message: string) => {
    let toast = document.querySelector<HTMLElement>('.aman-runtime-toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'aman-runtime-toast'
      document.body.appendChild(toast)
    }
    toast.textContent = message
    toast.classList.add('is-visible')
    window.setTimeout(() => toast?.classList.remove('is-visible'), 2_200)
  }

  const clearDragLock = (airport: string, callsign: string, previewId = '') => {
    const key = `${airport}:${callsign}`
    const row = findRow(airport, callsign)
    if (row && (!previewId || row.dataset.realtimeLockPreview === previewId)) {
      row.classList.remove('is-realtime-locked')
      delete row.dataset.realtimeLockActor
      delete row.dataset.realtimeLockPreview
      delete row.dataset.realtimeLockExpiresAt
    }
    const timer = lockTimers.get(key)
    if (timer != null) window.clearTimeout(timer)
    lockTimers.delete(key)
  }

  const applyDragLock = (message: {
    airport?: string
    callsign?: string
    previewId?: string
    actor?: { vid?: string; name?: string }
    expiresAt?: number
  }) => {
    const airport = String(message.airport || '').toUpperCase()
    const callsign = String(message.callsign || '').toUpperCase()
    const previewId = String(message.previewId || '')
    const expiresAt = Number(message.expiresAt)
    if (!airport || !callsign || !previewId || !Number.isFinite(expiresAt)) return
    const row = findRow(airport, callsign)
    if (!row) return
    const actor = String(message.actor?.name || message.actor?.vid || 'another controller')
    row.classList.add('is-realtime-locked')
    row.dataset.realtimeLockActor = actor
    row.dataset.realtimeLockPreview = previewId
    row.dataset.realtimeLockExpiresAt = String(expiresAt)
    const key = `${airport}:${callsign}`
    const currentTimer = lockTimers.get(key)
    if (currentTimer != null) window.clearTimeout(currentTimer)
    lockTimers.set(key, window.setTimeout(() => {
      if (Number(row.dataset.realtimeLockExpiresAt) <= Date.now()) clearDragLock(airport, callsign, previewId)
    }, Math.max(0, expiresAt - Date.now()) + 20))
  }

  const applyPreview = (message: {
    airport?: string
    callsign?: string
    previewId?: string
    rows?: Array<{ callsign?: string; targetAt?: string }>
  }) => {
    const airport = String(message.airport || '').toUpperCase()
    const subjectCallsign = String(message.callsign || '').toUpperCase()
    const previewId = String(message.previewId || '')
    if (!airport || !previewId || !Array.isArray(message.rows)) return
    if (subjectCallsign) previewSubjects.set(previewId, `${airport}:${subjectCallsign}`)
    const originals = previewOriginals.get(previewId) ?? new Map()
    previewOriginals.set(previewId, originals)

    for (const item of message.rows) {
      const callsign = String(item.callsign || '').trim().toUpperCase()
      const valueMs = new Date(String(item.targetAt || '')).getTime()
      if (!callsign || !Number.isFinite(valueMs)) continue
      const row = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((candidate) => {
        const info = rowInfo(candidate)
        return info?.airport === airport && info.callsign === callsign
      })
      if (!row || row.classList.contains('is-dragging')) continue
      if (!originals.has(row)) {
        originals.set(row, {
          offset: row.style.getPropertyValue('--offset-px'),
          tldt: row.querySelector<HTMLElement>('.tldt')?.textContent || '',
        })
      }
      const offsetPx = (Date.now() - valueMs) / 60_000 * PX_PER_MINUTE
      row.style.setProperty('--offset-px', `${offsetPx}px`)
      const label = row.querySelector<HTMLElement>('.tldt')
      if (label) label.textContent = formatHms(valueMs)
      row.dataset.realtimePreview = previewId
    }
  }

  const dispatchFlightState = (state: unknown) => {
    if (!state) return
    window.dispatchEvent(new CustomEvent('aman:realtime-flight-state', { detail: state }))
  }

  const dispatchSequenceOrder = (state: unknown) => {
    if (!state) return
    window.dispatchEvent(new CustomEvent('aman:realtime-sequence-order', { detail: state }))
  }

  const handleMessage = (room: Room, event: MessageEvent) => {
    let message: any
    try { message = JSON.parse(String(event.data)) } catch { return }

    if (message?.type === 'role') {
      room.leader = message.leader === true
      sendAutoSnapshot(room)
      return
    }
    if (message?.type === 'room_snapshot') {
      if (message.autoSnapshot && canonicalSnapshotIsFresh(message.autoSnapshot.updatedAt)) {
        window.dispatchEvent(new CustomEvent('aman:canonical-auto-snapshot', {
          detail: { airport: room.airport, arrivals: message.autoSnapshot.arrivals || [] },
        }))
      }
      message.flightStates?.forEach(dispatchFlightState)
      message.sequenceOrders?.forEach(dispatchSequenceOrder)
      message.dragLocks?.forEach(applyDragLock)
      return
    }
    if (message?.type === 'auto_snapshot') {
      window.dispatchEvent(new CustomEvent('aman:canonical-auto-snapshot', {
        detail: { airport: room.airport, arrivals: message.arrivals || [] },
      }))
      return
    }
    if (message?.type === 'drag_preview') {
      applyDragLock(message)
      applyPreview(message)
      return
    }
    if (message?.type === 'drag_lock') {
      applyDragLock(message)
      return
    }
    if (message?.type === 'drag_unlock') {
      clearDragLock(room.airport, String(message.callsign || '').toUpperCase(), String(message.previewId || ''))
      return
    }
    if (message?.type === 'drag_denied') {
      const previewId = String(message.previewId || '')
      if (!activeDrag || activeDrag.previewId !== previewId) return
      const denied = activeDrag
      const actor = String(message.actor?.name || message.actor?.vid || 'another controller')
      showMessage(`${denied.callsign} is being controlled by ${actor}`)
      const cancelEvent = typeof PointerEvent === 'function'
        ? new PointerEvent('pointercancel', { bubbles: true, pointerId: denied.pointerId })
        : new Event('pointercancel', { bubbles: true })
      denied.row.dispatchEvent(cancelEvent)
      if (activeDrag === denied) {
        send(denied.airport, { type: 'drag_cancel', previewId: denied.previewId })
        activeDrag = null
      }
      applyDragLock(message)
      return
    }
    if (message?.type === 'drag_cancel') {
      const previewId = String(message.previewId || '')
      clearPreview(previewId)
      clearPreviewCancelTimer(previewId)
      window.dispatchEvent(new CustomEvent('aman:realtime-manual-release-cancel', {
        detail: { airport: room.airport, previewId },
      }))
      return
    }
    if (message?.type === 'drag_release') {
      const previewId = String(message.previewId || '')
      const airport = String(message.airport || '').toUpperCase()
      const callsign = String(message.callsign || '').toUpperCase()
      const row = findRow(airport, callsign)
      const original = row ? previewOriginals.get(previewId)?.get(row) : null
      const originalOffset = Number.parseFloat(original?.offset || '')
      const originalTargetAt = Number.isFinite(originalOffset)
        ? new Date(Date.now() - originalOffset / PX_PER_MINUTE * 60_000).toISOString()
        : null
      window.dispatchEvent(new CustomEvent('aman:realtime-manual-release', {
        detail: {
          ...message,
          originalTargetAt,
          originalRunway: row ? rowInfo(row)?.runway || '' : '',
          originalWasManual: row?.classList.contains('is-stable') || row?.dataset.targetMode === 'MANUAL',
        },
      }))
      return
    }
    if (message?.type === 'flight_commit') {
      clearCommittedPreview(message)
      dispatchFlightState(message.flightState)
      return
    }
    if (message?.type === 'sequence_commit') dispatchSequenceOrder(message.sequenceOrder)
    if (message?.type === 'commit_rejected') {
      if (message.entity === 'flight') dispatchFlightState(message.current)
      if (message.entity === 'sequence') dispatchSequenceOrder(message.current)
    }
  }

  const connect = (room: Room, nextServiceDate = activeServiceDate) => {
    if (disposed) return
    if (room.reconnectTimer != null) {
      window.clearTimeout(room.reconnectTimer)
      room.reconnectTimer = null
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ serviceDate: nextServiceDate, airport: room.airport })
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/sequence/realtime?${params}`)
    room.socket = socket
    room.serviceDate = nextServiceDate
    socket.addEventListener('open', () => {
      if (room.socket !== socket || room.serviceDate !== activeServiceDate) {
        socket.close(1000, 'stale service date')
        return
      }
      room.attempt = 0
      room.status = 'LIVE'
      renderHealth()
      window.dispatchEvent(new CustomEvent('aman:realtime-health', { detail: { airport: room.airport, status: 'LIVE' } }))
    })
    socket.addEventListener('message', (event) => {
      if (room.socket === socket && room.serviceDate === activeServiceDate) handleMessage(room, event)
    })
    const reconnect = () => {
      if (room.socket !== socket || disposed) return
      room.socket = null
      room.leader = false
      room.status = 'DEGRADED'
      renderHealth()
      window.dispatchEvent(new CustomEvent('aman:realtime-health', { detail: { airport: room.airport, status: 'DEGRADED' } }))
      const delay = realtimeReconnectDelayMs(room.attempt++)
      room.reconnectTimer = window.setTimeout(() => {
        room.reconnectTimer = null
        connect(room)
      }, delay)
    }
    socket.addEventListener('close', reconnect)
    socket.addEventListener('error', () => socket.close())
  }

  for (const airport of AIRPORTS) {
    const room: Room = {
      airport,
      socket: null,
      leader: false,
      attempt: 0,
      reconnectTimer: null,
      serviceDate: activeServiceDate,
      latestLocal: [],
      status: 'CONNECTING',
    }
    rooms.set(airport, room)
    connect(room)
  }
  renderHealth()

  const reconnectForCurrentServiceDate = () => {
    const nextServiceDate = realtimeUtcServiceDate()
    if (nextServiceDate === activeServiceDate) return false
    activeServiceDate = nextServiceDate
    activeDrag = null
    previewOriginals.forEach((_value, key) => clearPreview(key))
    for (const room of rooms.values()) {
      if (room.reconnectTimer != null) window.clearTimeout(room.reconnectTimer)
      room.reconnectTimer = null
      const previousSocket = room.socket
      room.socket = null
      room.leader = false
      room.attempt = 0
      room.status = 'CONNECTING'
      previousSocket?.close(1000, 'UTC service date changed')
      connect(room, nextServiceDate)
    }
    renderHealth()
    return true
  }

  const scheduleServiceDateCheck = () => {
    if (disposed) return
    reconnectForCurrentServiceDate()
    if (serviceDateTimer != null) window.clearTimeout(serviceDateTimer)
    serviceDateTimer = window.setTimeout(() => {
      serviceDateTimer = null
      scheduleServiceDateCheck()
    }, millisecondsUntilNextUtcServiceDate() + 50)
  }
  scheduleServiceDateCheck()

  const onLocalAutoSnapshot = (event: Event) => {
    const predictions = (event as CustomEvent<LocalAutoSnapshotDetail>).detail?.predictions || []
    for (const room of rooms.values()) {
      room.latestLocal = predictions
        .filter((item) => String(item.id || '').startsWith(`${room.airport}:`))
        .map((item) => ({ id: String(item.id), predictedIawpAt: String(item.predictedIawpAt) }))
      sendAutoSnapshot(room)
    }
  }

  const onCommit = (event: Event) => {
    const detail = (event as CustomEvent<RealtimeCommitDetail>).detail
    const airport = String(detail?.airport || '').toUpperCase()
    if (!airport) return
    if (detail.flightState) {
      const callsign = String((detail.flightState as { callsign?: string }).callsign || '').toUpperCase()
      previewSubjects.forEach((subject, previewId) => {
        if (subject === `${airport}:${callsign}`) clearPreviewCancelTimer(previewId)
      })
      send(airport, { type: 'flight_commit', flightState: detail.flightState })
    }
    if (detail.sequenceOrder) send(airport, { type: 'sequence_commit', sequenceOrder: detail.sequenceOrder })
  }

  const onPointerDown = (event: PointerEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aman-flight-row') : null
    if (!row || (event.target instanceof Element && event.target.closest('select')) || row.classList.contains('is-demo')) return
    if (row.classList.contains('is-realtime-locked')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      showMessage(`${row.querySelector('strong')?.textContent?.trim() || 'Flight'} is being controlled by ${row.dataset.realtimeLockActor || 'another controller'}`)
      return
    }
    const info = rowInfo(row)
    if (!info) return
    activeDrag = {
      airport: info.airport,
      callsign: info.callsign,
      previewId: crypto.randomUUID(),
      lastSentAt: 0,
      pointerId: event.pointerId,
      row,
    }
    previewSubjects.set(activeDrag.previewId, `${info.airport}:${info.callsign}`)
    send(info.airport, {
      type: 'drag_begin',
      callsign: info.callsign,
      previewId: activeDrag.previewId,
    })
  }

  const publishDragPreview = () => {
    if (!activeDrag) return
    const airport = activeDrag.airport
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).flatMap((row) => {
      const info = rowInfo(row)
      const valueMs = targetMs(row)
      return info && info.airport === airport && valueMs != null
        ? [{ callsign: info.callsign, targetAt: new Date(valueMs).toISOString(), runway: info.runway }]
        : []
    })
    send(airport, {
      type: 'drag_preview',
      callsign: activeDrag.callsign,
      previewId: activeDrag.previewId,
      rows,
    })
    activeDrag.lastSentAt = performance.now()
  }

  const publishDragRelease = (finished: FinishedDrag) => {
    const row = findRow(finished.airport, finished.callsign) ?? finished.row
    const info = rowInfo(row)
    const valueMs = targetMs(row)
    if (!info || info.airport !== finished.airport || info.callsign !== finished.callsign || valueMs == null) return
    send(finished.airport, {
      type: 'drag_release',
      callsign: finished.callsign,
      previewId: finished.previewId,
      targetAt: new Date(valueMs).toISOString(),
      runway: info.runway,
    })
  }

  const onPointerMove = () => {
    if (!activeDrag || performance.now() - activeDrag.lastSentAt < PREVIEW_INTERVAL_MS) return
    window.requestAnimationFrame(publishDragPreview)
  }

  const finishDrag = (cancel: boolean) => {
    if (!activeDrag) return
    if (!cancel) publishDragPreview()
    else {
      send(activeDrag.airport, { type: 'drag_cancel', previewId: activeDrag.previewId })
      clearPreview(activeDrag.previewId)
      clearPreviewCancelTimer(activeDrag.previewId)
    }
    const finished = activeDrag
    activeDrag = null
    if (!cancel) {
      // Capture the final React/cascade position after all pointer-up handlers
      // finish, without waiting for the Supabase write response.
      window.setTimeout(() => publishDragRelease(finished), 0)
      clearPreviewCancelTimer(finished.previewId)
      previewCancelTimers.set(finished.previewId, window.setTimeout(() => {
        previewCancelTimers.delete(finished.previewId)
        send(finished.airport, { type: 'drag_cancel', previewId: finished.previewId })
      }, 4_000))
    }
  }

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return
    reconnectForCurrentServiceDate()
    for (const room of rooms.values()) {
      if (!room.socket || room.socket.readyState === WebSocket.CLOSED) connect(room)
    }
  }
  const onPointerUp = () => finishDrag(false)
  const onPointerCancel = () => finishDrag(true)

  window.addEventListener('aman:local-auto-snapshot', onLocalAutoSnapshot)
  window.addEventListener('aman:realtime-commit-request', onCommit)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    disposed = true
    if (serviceDateTimer != null) window.clearTimeout(serviceDateTimer)
    rooms.forEach((room) => {
      if (room.reconnectTimer != null) window.clearTimeout(room.reconnectTimer)
      room.socket?.close(1000, 'runtime disposed')
    })
    previewOriginals.forEach((_value, key) => clearPreview(key))
    previewCancelTimers.forEach((timer) => window.clearTimeout(timer))
    previewCancelTimers.clear()
    lockTimers.forEach((timer) => window.clearTimeout(timer))
    document.querySelectorAll<HTMLElement>('.aman-flight-row.is-realtime-locked').forEach((row) => {
      row.classList.remove('is-realtime-locked')
      delete row.dataset.realtimeLockActor
      delete row.dataset.realtimeLockPreview
      delete row.dataset.realtimeLockExpiresAt
    })
    document.querySelector('.aman-runtime-realtime-status')?.remove()
    window.removeEventListener('aman:local-auto-snapshot', onLocalAutoSnapshot)
    window.removeEventListener('aman:realtime-commit-request', onCommit)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
