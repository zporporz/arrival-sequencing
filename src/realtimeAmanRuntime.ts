import { selectedAmanAirports } from './core/airports'
import type { RegionalArrivalState } from './core/arrivalSequencing'
type CanonicalArrival = { id: string; predictedIawpAt: string; regional?: RegionalArrivalState }
type LocalAutoSnapshotDetail = { predictions?: CanonicalArrival[] }
type RealtimeCommitDetail = { airport?: string; flightState?: unknown; sequenceOrder?: unknown }
type RealtimeCommitFailedDetail = { airport?: string; callsign?: string }
type FinishedDrag = {
  airport: string
  callsign: string
  previewId: string
  lastSentAt: number
  pointerId: number
  row: HTMLElement
  lastRows: Map<string, string>
}
type RemoteDragLock = {
  airport: string
  callsign: string
  previewId: string
  actor: string
  expiresAt: number
  phase: 'DRAGGING' | 'SAVING'
}

const PX_PER_MINUTE = 10
const PREVIEW_INTERVAL_MS = 50
const COMMIT_ACK_TIMEOUT_MS = 15_000
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
  const airport = title.match(/\b(VTBD|VTBS|VTCC|VTSP) RWY\b/)?.[1] || ''
  const runway = row.querySelector<HTMLSelectElement>('.runway-assignment select')?.value
    || row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().replace(/^(?:BD|BS|CC|SP)\//, '')
    || ''
  return airport && callsign ? { airport, callsign, runway: runway.toUpperCase() } : null
}

function targetMs(row: HTMLElement) {
  const exact = Date.parse(row.dataset.targetTldt || '')
  if (Number.isFinite(exact) && !row.dataset.realtimePreview) return exact
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
  const previewOriginals = new Map<string, Map<HTMLElement, { offset: string; tldt: string; targetAt?: string }>>()
  const previewSubjects = new Map<string, string>()
  const previewCancelTimers = new Map<string, number>()
  const lockTimers = new Map<string, number>()
  const dragLocks = new Map<string, RemoteDragLock>()
  let activeDrag: FinishedDrag | null = null
  let previewFramePending = false
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
    value.textContent = live === rooms.size ? 'LIVE' : live ? `DEGRADED ${live}/${rooms.size}` : 'DEGRADED'
    value.classList.toggle('is-warning', live !== rooms.size)
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
    // An old unlock/timeout must not remove a newer controller's indicator.
    if (previewId && dragLocks.get(key)?.previewId !== previewId) return
    dragLocks.delete(key)
    const row = findRow(airport, callsign)
    if (row && (!previewId || row.dataset.realtimeLockPreview === previewId)) {
      row.classList.remove('is-realtime-locked')
      delete row.dataset.realtimeLockActor
      delete row.dataset.realtimeLockPreview
      delete row.dataset.realtimeLockExpiresAt
      row.querySelector('.aman-realtime-drag-badge')?.remove()
    }
    const timer = lockTimers.get(key)
    if (timer != null) window.clearTimeout(timer)
    lockTimers.delete(key)
  }

  const renderDragLock = (lock: RemoteDragLock) => {
    const row = findRow(lock.airport, lock.callsign)
    if (!row || lock.expiresAt <= Date.now()) return
    row.classList.add('is-realtime-locked')
    row.dataset.realtimeLockActor = lock.actor
    row.dataset.realtimeLockPreview = lock.previewId
    row.dataset.realtimeLockExpiresAt = String(lock.expiresAt)
    let badge = row.querySelector<HTMLElement>('.aman-realtime-drag-badge')
    if (!badge) {
      badge = document.createElement('span')
      badge.className = 'aman-realtime-drag-badge'
      badge.setAttribute('role', 'status')
      badge.setAttribute('aria-live', 'polite')
      row.appendChild(badge)
    }
    const text = `${lock.phase} · ${lock.actor}`
    // Use text, never HTML. Do not recreate the live region on every preview.
    if (badge.textContent !== text) badge.textContent = text
    badge.dataset.phase = lock.phase
    badge.title = `${lock.callsign} · ${text}`
    badge.setAttribute('aria-label', badge.title)
  }

  const markDragReleased = (airport: string, callsign: string, previewId: string) => {
    const lock = dragLocks.get(`${airport}:${callsign}`)
    if (!lock || lock.previewId !== previewId) return
    lock.phase = 'SAVING'
    renderDragLock(lock)
  }

  const clearAirportLocks = (airport: string) => {
    for (const lock of dragLocks.values()) {
      if (lock.airport === airport) clearDragLock(airport, lock.callsign, lock.previewId)
    }
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
    const key = `${airport}:${callsign}`
    if (expiresAt <= Date.now()) return
    const previous = dragLocks.get(key)
    if (previous && previous.expiresAt > expiresAt) return
    const actor = String(message.actor?.name || message.actor?.vid || 'another controller').trim().slice(0, 100)
    const lock: RemoteDragLock = { airport, callsign, previewId, actor, expiresAt,
      phase: previous?.previewId === previewId ? previous.phase : 'DRAGGING' }
    dragLocks.set(key, lock)
    renderDragLock(lock)
    const currentTimer = lockTimers.get(key)
    if (currentTimer != null) window.clearTimeout(currentTimer)
    lockTimers.set(key, window.setTimeout(() => {
      if ((dragLocks.get(key)?.expiresAt ?? Infinity) <= Date.now()) clearDragLock(airport, callsign, previewId)
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
          targetAt: row.dataset.targetTldt,
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
      if (message.autoSnapshot && (canonicalSnapshotIsFresh(message.autoSnapshot.updatedAt)
        || ['VTCC', 'VTSP'].includes(room.airport))) {
        window.dispatchEvent(new CustomEvent('aman:canonical-auto-snapshot', {
          detail: { airport: room.airport, arrivals: message.autoSnapshot.arrivals || [] },
        }))
      }
      message.flightStates?.forEach(dispatchFlightState)
      message.sequenceOrders?.forEach(dispatchSequenceOrder)
      message.dragLocks?.forEach(applyDragLock)
      message.pendingReleases?.forEach((release: { callsign?: string; previewId?: string }) => {
        markDragReleased(room.airport, String(release.callsign || '').toUpperCase(), String(release.previewId || ''))
        window.dispatchEvent(new CustomEvent('aman:realtime-manual-release', { detail: release }))
      })
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
      for (const lock of dragLocks.values()) {
        if (lock.airport === room.airport && lock.previewId === previewId) clearDragLock(lock.airport, lock.callsign, previewId)
      }
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
      markDragReleased(airport, callsign, previewId)
      const row = findRow(airport, callsign)
      const original = row ? previewOriginals.get(previewId)?.get(row) : null
      const originalOffset = Number.parseFloat(original?.offset || '')
      const originalTargetAt = original?.targetAt || (Number.isFinite(originalOffset)
        ? new Date(Date.now() - originalOffset / PX_PER_MINUTE * 60_000).toISOString()
        : null)
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
      if (!message.preservePreview) clearCommittedPreview(message)
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
    if (disposed || rooms.get(room.airport) !== room) return
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
      if (rooms.get(room.airport) !== room || room.socket !== socket || room.serviceDate !== activeServiceDate) {
        socket.close(1000, 'stale service date')
        return
      }
      room.attempt = 0
      room.status = 'LIVE'
      renderHealth()
      window.dispatchEvent(new CustomEvent('aman:realtime-health', { detail: { airport: room.airport, status: 'LIVE' } }))
    })
    socket.addEventListener('message', (event) => {
      if (rooms.get(room.airport) === room && room.socket === socket && room.serviceDate === activeServiceDate) handleMessage(room, event)
    })
    const reconnect = () => {
      if (rooms.get(room.airport) !== room || room.socket !== socket || disposed) return
      clearAirportLocks(room.airport)
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

  const syncRooms = () => {
    const selected = selectedAmanAirports()
    for (const [airport, room] of rooms) {
      if (selected.some(code => code === airport)) continue
      rooms.delete(airport)
      clearAirportLocks(airport)
      if (room.reconnectTimer != null) window.clearTimeout(room.reconnectTimer)
      room.socket?.close(1000, 'Airport view changed')
    }
    for (const airport of selected) {
      if (rooms.has(airport)) continue
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
  }
  syncRooms()
  window.addEventListener('aman:airport-selection-change', syncRooms)

  const reconnectForCurrentServiceDate = () => {
    const nextServiceDate = realtimeUtcServiceDate()
    if (nextServiceDate === activeServiceDate) return false
    activeServiceDate = nextServiceDate
    activeDrag = null
    previewOriginals.forEach((_value, key) => clearPreview(key))
    for (const room of rooms.values()) {
      clearAirportLocks(room.airport)
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
        .map((item) => ({ id: String(item.id), predictedIawpAt: String(item.predictedIawpAt), ...(item.regional ? { regional: item.regional } : {}) }))
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
      // The authenticated API publishes the committed state through its private binding.
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aman-flight-row') : null
    if (!row || (event.target instanceof Element && event.target.closest('select')) || row.classList.contains('is-demo')) return
    if (Number(row.dataset.realtimeLockExpiresAt) > Date.now()) {
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
      lastRows: new Map(),
    }
    previewSubjects.set(activeDrag.previewId, `${info.airport}:${info.callsign}`)
    send(info.airport, {
      type: 'drag_begin',
      callsign: info.callsign,
      previewId: activeDrag.previewId,
    })
  }

  const publishDragPreview = () => {
    previewFramePending = false
    if (!activeDrag) return
    const airport = activeDrag.airport
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).flatMap((row) => {
      const info = rowInfo(row)
      const valueMs = targetMs(row)
      if (!info || info.airport !== airport || valueMs == null) return []
      const targetAt = new Date(Math.round(valueMs / 1_000) * 1_000).toISOString()
      const signature = `${targetAt}:${info.runway}`
      if (activeDrag?.lastRows.get(info.callsign) === signature) return []
      activeDrag?.lastRows.set(info.callsign, signature)
      return [{ callsign: info.callsign, targetAt, runway: info.runway }]
    })
    if (!rows.length) return
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
    if (!activeDrag || previewFramePending || performance.now() - activeDrag.lastSentAt < PREVIEW_INTERVAL_MS) return
    previewFramePending = true
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
      }, COMMIT_ACK_TIMEOUT_MS))
    }
  }

  const onCommitFailed = (event: Event) => {
    const detail = (event as CustomEvent<RealtimeCommitFailedDetail>).detail
    const airport = String(detail?.airport || '').toUpperCase()
    const callsign = String(detail?.callsign || '').toUpperCase()
    if (!airport || !callsign) return
    previewSubjects.forEach((subject, previewId) => {
      if (subject !== `${airport}:${callsign}`) return
      clearPreviewCancelTimer(previewId)
      send(airport, { type: 'drag_cancel', previewId })
      clearPreview(previewId)
      previewSubjects.delete(previewId)
    })
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
  window.addEventListener('aman:realtime-commit-failed', onCommitFailed)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('visibilitychange', onVisibility)

  // A room snapshot can arrive before traffic rows mount. Keep the indicator
  // available for late rows/remounts without relying on React-owned className.
  const lockObserver = new MutationObserver(() => dragLocks.forEach(renderDragLock))
  lockObserver.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })

  return () => {
    disposed = true
    lockObserver.disconnect()
    window.removeEventListener('aman:airport-selection-change', syncRooms)
    if (serviceDateTimer != null) window.clearTimeout(serviceDateTimer)
    rooms.forEach((room) => {
      if (room.reconnectTimer != null) window.clearTimeout(room.reconnectTimer)
      room.socket?.close(1000, 'runtime disposed')
    })
    previewOriginals.forEach((_value, key) => clearPreview(key))
    previewCancelTimers.forEach((timer) => window.clearTimeout(timer))
    previewCancelTimers.clear()
    lockTimers.forEach((timer) => window.clearTimeout(timer))
    dragLocks.clear()
    document.querySelectorAll<HTMLElement>('.aman-flight-row[data-realtime-lock-preview]').forEach((row) => {
      row.classList.remove('is-realtime-locked')
      delete row.dataset.realtimeLockActor
      delete row.dataset.realtimeLockPreview
      delete row.dataset.realtimeLockExpiresAt
      row.querySelector('.aman-realtime-drag-badge')?.remove()
    })
    document.querySelector('.aman-runtime-realtime-status')?.remove()
    window.removeEventListener('aman:local-auto-snapshot', onLocalAutoSnapshot)
    window.removeEventListener('aman:realtime-commit-request', onCommit)
    window.removeEventListener('aman:realtime-commit-failed', onCommitFailed)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
