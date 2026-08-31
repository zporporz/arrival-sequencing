import { getAuthenticatedIdentity } from './browserIdentity'

type WorkspaceState = {
  service_date: string
  airport: string
  profile_id: string
  runway_modes: Record<string, string>
  spacing_nm: Record<string, number>
  settings: Record<string, unknown>
  revision: number
  updated_by_vid: string | null
  updated_by_name: string | null
  updated_at: string
}

type FlightState = {
  service_date: string
  airport: string
  callsign: string
  canonical_session_id: string
  connection_phase: string
  target_mode: 'AUTO' | 'MANUAL'
  manual_tldt: string | null
  manual_runway: string | null
  manual_updated_by_vid: string | null
  manual_updated_by_name: string | null
  manual_updated_at: string | null
  auto_baseline_tldt: string | null
  auto_baseline_runway: string | null
  auto_baseline_rank: number | null
  auto_baseline_captured_at: string | null
  auto_return_tldt: string | null
  auto_return_floor_tldt: string | null
  auto_return_runway: string | null
  auto_returned_at: string | null
  auto_returned_by_vid: string | null
  auto_returned_by_name: string | null
  holding_mode: 'AUTO' | 'HOLD' | 'NO_HOLD'
  holding_fix: string | null
  holding_leave_at: string | null
  revision: number
  updated_at: string
}

type SequenceOrder = {
  service_date: string
  airport: string
  runway: string
  ordered_callsigns: string[]
  revision: number
  updated_by_vid: string | null
  updated_by_name: string | null
  updated_at: string
}

type RealtimeManualRelease = {
  airport?: string
  callsign?: string
  previewId?: string
  targetAt?: string
  runway?: string
  originalTargetAt?: string | null
  originalRunway?: string
  originalWasManual?: boolean
}

type SharedStatePayload = {
  serviceDate: string
  workspaceStates: WorkspaceState[]
  flightStates: FlightState[]
  sequenceOrders?: SequenceOrder[]
  error?: string
}

type ReactChangeProps = {
  onChange?: (event: { target: HTMLInputElement | HTMLSelectElement }) => void
}

type ReactRowProps = {
  onPointerDown?: (event: FakePointerEvent) => void
  onPointerMove?: (event: FakePointerEvent) => void
  onPointerUp?: (event: FakePointerEvent) => void
  onDoubleClick?: () => void
}

type FakePointerEvent = {
  button: number
  preventDefault: () => void
  currentTarget: {
    setPointerCapture: (pointerId: number) => void
    hasPointerCapture: (pointerId: number) => boolean
    releasePointerCapture: (pointerId: number) => void
  }
  pointerId: number
  clientY: number
}

const SHARED_STATE_EVENT = 'aman:shared-state'
const SHARED_HEALTH_EVENT = 'aman:shared-state-health'
const PX_PER_MINUTE = 10
const POINTER_ID = 70421
const AIRPORTS = ['VTBD', 'VTBS'] as const

function utcServiceDate() {
  return new Date().toISOString().slice(0, 10)
}

function flightKey(airport: string, callsign: string) {
  return `${airport}:${callsign}`
}

function finiteTime(value: string | null | undefined) {
  if (!value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function invokeReactChange(element: HTMLInputElement | HTMLSelectElement, value: string) {
  element.value = value
  reactProps<ReactChangeProps>(element)?.onChange?.({ target: element })
}

function rowIdentity(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  return airport && callsign ? { airport, callsign, key: flightKey(airport, callsign) } : null
}

function findFlightRow(airport: string, callsign: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((row) => {
    const identity = rowIdentity(row)
    return identity?.airport === airport && identity.callsign === callsign
  }) ?? null
}

function currentTargetMs(row: HTMLElement) {
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return Date.now() - offsetPx / PX_PER_MINUTE * 60_000

  const hm = row.children.item(0)?.textContent?.trim().match(/^(\d{2}):(\d{2})$/)
  if (!hm) return null
  const now = new Date()
  const candidate = new Date(now)
  candidate.setUTCHours(Number(hm[1]), Number(hm[2]), 0, 0)
  const delta = candidate.getTime() - now.getTime()
  if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || ''
}

function fakePointer(clientY: number): FakePointerEvent {
  return {
    button: 0,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    },
    pointerId: POINTER_ID,
    clientY,
  }
}

function applyTargetThroughReact(row: HTMLElement, targetMs: number) {
  const currentMs = currentTargetMs(row)
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false

  const deltaMinutes = (targetMs - currentMs) / 60_000
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  props.onPointerUp(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  return true
}

function clearTargetThroughReact(row: HTMLElement) {
  const props = reactProps<ReactRowProps>(row)
  if (!props?.onDoubleClick) return false
  props.onDoubleClick()
  return true
}

function airportFromConfigBlock(block: HTMLElement) {
  const label = block.querySelector<HTMLElement>('.aman-profile-select > span')?.textContent?.trim().toUpperCase() || ''
  return label.match(/^(VTBD|VTBS)\s+CONFIG$/)?.[1] || ''
}

function findConfigBlock(airport: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-runway-config-block'))
    .find((block) => airportFromConfigBlock(block) === airport) ?? null
}

function readWorkspaceFromDom(airport: string) {
  const block = findConfigBlock(airport)
  if (!block) return null
  const profileId = block.querySelector<HTMLSelectElement>('.aman-profile-select select')?.value || 'CUSTOM'
  const runwayModes: Record<string, string> = {}
  const spacingNm: Record<string, number> = {}

  block.querySelectorAll<HTMLElement>('.aman-runway-card').forEach((card) => {
    const runway = card.querySelector('b')?.textContent?.trim().toUpperCase() || ''
    const mode = card.querySelector<HTMLSelectElement>(':scope > select')?.value || ''
    const spacing = Number(card.querySelector<HTMLInputElement>('input')?.value)
    if (!runway) return
    if (mode) runwayModes[runway] = mode
    if (Number.isFinite(spacing) && spacing > 0) spacingNm[runway] = spacing
  })

  return { airport, profileId, runwayModes, spacingNm }
}

function setSharedHealth(status: 'CONNECTING' | 'LIVE' | 'ERROR', detail = '') {
  window.dispatchEvent(new CustomEvent(SHARED_HEALTH_EVENT, { detail: { status, detail } }))
  const list = document.querySelector<HTMLElement>('.aman-status-list')
  if (!list) return
  let row = list.querySelector<HTMLElement>('.aman-runtime-shared-status')
  if (!row) {
    row = document.createElement('div')
    row.className = 'aman-runtime-shared-status'
    const label = document.createElement('dt')
    label.textContent = 'Shared AMAN'
    const value = document.createElement('dd')
    value.textContent = 'CONNECTING'
    row.append(label, value)
    list.appendChild(row)
  }
  const value = row.querySelector('dd')
  if (!value) return
  value.textContent = status === 'ERROR' && detail ? `ERROR · ${detail.slice(0, 36)}` : status
  value.classList.toggle('is-warning', status === 'ERROR')
}

async function readSharedState(serviceDate: string) {
  const params = new URLSearchParams({ serviceDate, airports: AIRPORTS.join(',') })
  const response = await fetch(`/api/sequence/aman-state?${params.toString()}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  const payload = await response.json() as SharedStatePayload
  if (!response.ok) throw new Error(payload.error || `Shared AMAN API returned ${response.status}`)
  return payload
}

async function writeSharedState(body: Record<string, unknown>) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { error?: string; workspaceState?: WorkspaceState; flightState?: FlightState | null }
  if (!response.ok) throw new Error(payload.error || `Shared AMAN API returned ${response.status}`)
  return payload
}

export function installSharedAmanRuntime() {
  let disposed = false
  let serviceDate = utcServiceDate()
  const workspaceStates = new Map<string, WorkspaceState>()
  const flightStates = new Map<string, FlightState>()
  const sequenceOrders = new Map<string, SequenceOrder>()
  const workspaceWriteTimers = new Map<string, number>()
  const flightWriteTimers = new Map<string, number>()
  const localInteractionStart = new WeakMap<HTMLElement, number>()
  const localAutoBaselines = new WeakMap<HTMLElement, {
    tldt: string | null
    runway: string | null
    rank: number | null
  }>()
  const identity = getAuthenticatedIdentity()

  const emitState = () => {
    window.dispatchEvent(new CustomEvent(SHARED_STATE_EVENT, {
      detail: {
        serviceDate,
        workspaceStates: [...workspaceStates.values()],
        flightStates: [...flightStates.values()],
        sequenceOrders: [...sequenceOrders.values()],
      },
    }))
  }

  const mergeWorkspace = (state: WorkspaceState | null | undefined) => {
    if (!state || state.service_date !== serviceDate || !state.airport) return
    const current = workspaceStates.get(state.airport)
    if (current && Number(state.revision) < Number(current.revision)) return
    workspaceStates.set(state.airport, state)
    emitState()
  }

  const mergeFlight = (state: FlightState | null | undefined) => {
    if (!state || state.service_date !== serviceDate || !state.airport || !state.callsign) return false
    const key = flightKey(state.airport, state.callsign)
    const current = flightStates.get(key)
    if (current && Number(state.revision) < Number(current.revision)) return false
    flightStates.set(key, state)
    emitState()
    return true
  }

  const mergeSequenceOrder = (state: SequenceOrder | null | undefined) => {
    if (!state || state.service_date !== serviceDate || !state.airport || !state.runway) return
    const key = `${state.airport}:${state.runway}`
    const current = sequenceOrders.get(key)
    if (current && Number(state.revision) < Number(current.revision)) return
    sequenceOrders.set(key, state)
    emitState()
  }

  const applyWorkspaceDetails = (state: WorkspaceState) => {
    const block = findConfigBlock(state.airport)
    if (!block) return

    block.querySelectorAll<HTMLElement>('.aman-runway-card').forEach((card) => {
      const runway = card.querySelector('b')?.textContent?.trim().toUpperCase() || ''
      if (!runway) return
      const modeSelect = card.querySelector<HTMLSelectElement>(':scope > select')
      const spacingInput = card.querySelector<HTMLInputElement>('input')
      const remoteMode = state.runway_modes?.[runway]
      const remoteSpacing = Number(state.spacing_nm?.[runway])
      if (modeSelect && remoteMode && modeSelect.value !== remoteMode) invokeReactChange(modeSelect, remoteMode)
      if (spacingInput && Number.isFinite(remoteSpacing) && remoteSpacing > 0 && Math.abs(Number(spacingInput.value) - remoteSpacing) > 0.01) {
        invokeReactChange(spacingInput, String(remoteSpacing))
      }
    })
    block.dataset.sharedRevision = String(state.revision)
    block.title = `Shared config · ${state.updated_by_name || state.updated_by_vid || 'IVAO'} · revision ${state.revision}`
  }

  const applyWorkspace = (state: WorkspaceState) => {
    const block = findConfigBlock(state.airport)
    if (!block || block.dataset.sharedRevision === String(state.revision)) return
    const profileSelect = block.querySelector<HTMLSelectElement>('.aman-profile-select select')
    const canSelectProfile = profileSelect
      && state.profile_id !== 'CUSTOM'
      && Array.from(profileSelect.options).some((option) => option.value === state.profile_id)
    if (profileSelect && canSelectProfile && profileSelect.value !== state.profile_id) {
      invokeReactChange(profileSelect, state.profile_id)
      window.setTimeout(() => applyWorkspaceDetails(state), 0)
    } else {
      applyWorkspaceDetails(state)
    }
  }

  const applyFlight = (state: FlightState) => {
    const row = findFlightRow(state.airport, state.callsign)
    if (!row || row.classList.contains('is-dragging')) return
    if (row.dataset.sharedRevision === String(state.revision)) return

    const isManualLocally = row.classList.contains('is-stable')
      || row.querySelector('.runway-assignment.is-manual') != null

    if (state.target_mode === 'AUTO') {
      if (isManualLocally) clearTargetThroughReact(row)
      row.dataset.targetMode = 'AUTO'
      row.dataset.sharedRevision = String(state.revision)
      delete row.dataset.sharedActor
      delete row.dataset.realtimeReleasePreview
      return
    }

    const targetMs = finiteTime(state.manual_tldt)
    if (targetMs == null || !state.manual_runway) return

    const runwaySelect = row.querySelector<HTMLSelectElement>('.runway-assignment select')
    if (runwaySelect && runwaySelect.value !== state.manual_runway) {
      invokeReactChange(runwaySelect, state.manual_runway)
    }

    window.requestAnimationFrame(() => {
      const currentRow = findFlightRow(state.airport, state.callsign)
      if (!currentRow) return
      const currentMs = currentTargetMs(currentRow)
      if (currentMs == null || Math.abs(currentMs - targetMs) > 3000 || !currentRow.classList.contains('is-stable')) {
        applyTargetThroughReact(currentRow, targetMs)
      }
      currentRow.dataset.targetMode = 'MANUAL'
      currentRow.dataset.sharedRevision = String(state.revision)
      currentRow.dataset.sharedActor = state.manual_updated_by_name || state.manual_updated_by_vid || 'IVAO'
      delete currentRow.dataset.realtimeReleasePreview
      const title = currentRow.getAttribute('title') || ''
      if (!title.includes('SHARED MANUAL')) {
        currentRow.setAttribute('title', `${title} · SHARED MANUAL by ${currentRow.dataset.sharedActor}`)
      }
    })
  }

  const applyAll = () => {
    workspaceStates.forEach(applyWorkspace)
    flightStates.forEach(applyFlight)
  }

  const refresh = async () => {
    try {
      const nextServiceDate = utcServiceDate()
      if (nextServiceDate !== serviceDate) {
        serviceDate = nextServiceDate
        workspaceStates.clear()
        flightStates.clear()
        sequenceOrders.clear()
      }
      const payload = await readSharedState(serviceDate)
      workspaceStates.clear()
      flightStates.clear()
      sequenceOrders.clear()
      payload.workspaceStates.forEach((state) => workspaceStates.set(state.airport, state))
      payload.flightStates.forEach((state) => flightStates.set(flightKey(state.airport, state.callsign), state))
      payload.sequenceOrders?.forEach((state) => sequenceOrders.set(`${state.airport}:${state.runway}`, state))
      emitState()
      applyAll()
      setSharedHealth('LIVE')
    } catch (error) {
      setSharedHealth('ERROR', error instanceof Error ? error.message : String(error))
    }
  }

  const saveWorkspace = async (airport: string) => {
    const current = readWorkspaceFromDom(airport)
    if (!current) return
    try {
      const result = await writeSharedState({
        action: 'syncWorkspace',
        serviceDate,
        airport,
        profileId: current.profileId,
        runwayModes: current.runwayModes,
        spacingNm: current.spacingNm,
        settings: workspaceStates.get(airport)?.settings || {
          holdingThresholdMinutes: 5,
          speedAdvisoryEnabled: true,
        },
      })
      mergeWorkspace(result.workspaceState)
      setSharedHealth('LIVE')
    } catch (error) {
      setSharedHealth('ERROR', error instanceof Error ? error.message : String(error))
    }
  }

  const queueWorkspaceSave = (airport: string) => {
    const previous = workspaceWriteTimers.get(airport)
    if (previous != null) window.clearTimeout(previous)
    workspaceWriteTimers.set(airport, window.setTimeout(() => {
      workspaceWriteTimers.delete(airport)
      void saveWorkspace(airport)
    }, 350))
  }

  const saveManualTarget = async (row: HTMLElement) => {
    const rowInfo = rowIdentity(row)
    const targetMs = currentTargetMs(row)
    const runway = rowRunway(row)
    if (!rowInfo || targetMs == null || !runway) return
    const baseline = localAutoBaselines.get(row)
    try {
      const result = await writeSharedState({
        action: 'setManualTarget',
        serviceDate,
        airport: rowInfo.airport,
        callsign: rowInfo.callsign,
        manualTldt: new Date(targetMs).toISOString(),
        manualRunway: runway,
        autoBaselineTldt: baseline?.tldt,
        autoBaselineRunway: baseline?.runway,
        autoBaselineRank: baseline?.rank,
      })
      mergeFlight(result.flightState)
      window.dispatchEvent(new CustomEvent('aman:realtime-commit-request', {
        detail: { airport: rowInfo.airport, flightState: result.flightState },
      }))
      setSharedHealth('LIVE')
    } catch (error) {
      setSharedHealth('ERROR', error instanceof Error ? error.message : String(error))
    }
  }

  const queueManualTargetSave = (row: HTMLElement, delay = 120) => {
    const rowInfo = rowIdentity(row)
    if (!rowInfo) return
    const previous = flightWriteTimers.get(rowInfo.key)
    if (previous != null) window.clearTimeout(previous)
    flightWriteTimers.set(rowInfo.key, window.setTimeout(() => {
      flightWriteTimers.delete(rowInfo.key)
      if (row.isConnected) void saveManualTarget(row)
    }, delay))
  }

  const clearManualTarget = async (row: HTMLElement) => {
    const rowInfo = rowIdentity(row)
    if (!rowInfo) return
    const previous = flightWriteTimers.get(rowInfo.key)
    if (previous != null) {
      window.clearTimeout(previous)
      flightWriteTimers.delete(rowInfo.key)
    }
    try {
      const result = await writeSharedState({
        action: 'clearManualTarget',
        serviceDate,
        airport: rowInfo.airport,
        callsign: rowInfo.callsign,
      })
      if (result.flightState) {
        mergeFlight(result.flightState)
        window.dispatchEvent(new CustomEvent('aman:realtime-commit-request', {
          detail: { airport: rowInfo.airport, flightState: result.flightState },
        }))
      }
      setSharedHealth('LIVE')
    } catch (error) {
      setSharedHealth('ERROR', error instanceof Error ? error.message : String(error))
    }
  }

  const onChange = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return

    const configBlock = target.closest<HTMLElement>('.aman-runway-config-block')
    if (configBlock) {
      const airport = airportFromConfigBlock(configBlock)
      if (airport) queueWorkspaceSave(airport)
      return
    }

    const row = target.closest<HTMLElement>('.aman-flight-row')
    if (row && target.closest('.runway-assignment select')) queueManualTargetSave(row, 80)
  }

  const onPointerDown = (event: PointerEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aman-flight-row') : null
    if (!row || (event.target instanceof Element && event.target.closest('select'))) return
    const targetMs = currentTargetMs(row)
    if (targetMs != null) localInteractionStart.set(row, targetMs)
    const isManual = row.classList.contains('is-stable') || row.dataset.targetMode === 'MANUAL'
    if (!isManual) {
      const rank = Number(row.dataset.autoBaselineRank)
      localAutoBaselines.set(row, {
        tldt: row.dataset.autoBaselineTldt || (targetMs == null ? null : new Date(targetMs).toISOString()),
        runway: row.dataset.autoBaselineRunway || rowRunway(row) || null,
        rank: Number.isInteger(rank) && rank > 0 ? rank : null,
      })
    }
  }

  const onPointerUp = (event: PointerEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aman-flight-row') : null
    if (!row || (event.target instanceof Element && event.target.closest('select'))) return
    if (!localInteractionStart.has(row)) return
    localInteractionStart.delete(row)
    queueManualTargetSave(row, 100)
  }

  const onDoubleClick = (event: MouseEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aman-flight-row') : null
    if (!row || (event.target instanceof Element && event.target.closest('select'))) return
    void clearManualTarget(row)
  }

  const releaseOriginals = new Map<string, {
    airport: string
    callsign: string
    targetMs: number
    runway: string
    wasManual: boolean
  }>()

  const onRealtimeManualRelease = (event: Event) => {
    const detail = (event as CustomEvent<RealtimeManualRelease>).detail
    const airport = String(detail?.airport || '').trim().toUpperCase()
    const callsign = String(detail?.callsign || '').trim().toUpperCase()
    const previewId = String(detail?.previewId || '')
    const runway = String(detail?.runway || '').trim().toUpperCase()
    const releasedMs = finiteTime(detail?.targetAt)
    const row = findFlightRow(airport, callsign)
    if (!airport || !callsign || !previewId || !runway || releasedMs == null || !row || row.classList.contains('is-dragging')) return

    if (!releaseOriginals.has(previewId)) {
      const originalMs = finiteTime(detail?.originalTargetAt) ?? currentTargetMs(row)
      if (originalMs == null) return
      releaseOriginals.set(previewId, {
        airport,
        callsign,
        targetMs: originalMs,
        runway: String(detail?.originalRunway || rowRunway(row)).trim().toUpperCase(),
        wasManual: detail?.originalWasManual === true,
      })
    }

    const runwaySelect = row.querySelector<HTMLSelectElement>('.runway-assignment select')
    if (runwaySelect && runwaySelect.value !== runway) invokeReactChange(runwaySelect, runway)
    window.requestAnimationFrame(() => {
      const currentRow = findFlightRow(airport, callsign)
      if (!currentRow) return
      applyTargetThroughReact(currentRow, releasedMs)
      currentRow.dataset.targetMode = 'MANUAL'
      currentRow.dataset.realtimeReleasePreview = previewId
    })
  }

  const onRealtimeManualReleaseCancel = (event: Event) => {
    const previewId = String((event as CustomEvent<{ previewId?: string }>).detail?.previewId || '')
    const original = releaseOriginals.get(previewId)
    releaseOriginals.delete(previewId)
    if (!original) return
    const row = findFlightRow(original.airport, original.callsign)
    if (!row) return
    const runwaySelect = row.querySelector<HTMLSelectElement>('.runway-assignment select')
    if (runwaySelect && original.runway && runwaySelect.value !== original.runway) invokeReactChange(runwaySelect, original.runway)
    window.requestAnimationFrame(() => {
      const currentRow = findFlightRow(original.airport, original.callsign)
      if (!currentRow) return
      applyTargetThroughReact(currentRow, original.targetMs)
      if (!original.wasManual) clearTargetThroughReact(currentRow)
      delete currentRow.dataset.realtimeReleasePreview
    })
  }

  const onForceRefresh = () => void refresh()
  const onRealtimeFlightState = (event: Event) => {
    const state = (event as CustomEvent<FlightState>).detail
    releaseOriginals.forEach((original, previewId) => {
      if (original.airport === state?.airport && original.callsign === state?.callsign) releaseOriginals.delete(previewId)
    })
    // A remote drag preview is restored as soon as its committed flight state
    // arrives. Apply the accepted MANUAL/AUTO state in the same event turn so
    // the other controller does not fall back to the pre-drag row while waiting
    // for the one-second recovery timer.
    if (mergeFlight(state)) applyFlight(state)
  }
  const onRealtimeSequenceOrder = (event: Event) => mergeSequenceOrder((event as CustomEvent<SequenceOrder>).detail)

  document.addEventListener('change', onChange)
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('dblclick', onDoubleClick)
  window.addEventListener('aman:force-shared-refresh', onForceRefresh)
  window.addEventListener('aman:realtime-manual-release', onRealtimeManualRelease)
  window.addEventListener('aman:realtime-manual-release-cancel', onRealtimeManualReleaseCancel)
  window.addEventListener('aman:realtime-flight-state', onRealtimeFlightState)
  window.addEventListener('aman:realtime-sequence-order', onRealtimeSequenceOrder)

  setSharedHealth('CONNECTING')
  void refresh()

  const applyTimer = window.setInterval(() => {
    applyAll()
    for (const airport of AIRPORTS) {
      if (!workspaceStates.has(airport) && findConfigBlock(airport)) queueWorkspaceSave(airport)
    }
  }, 1_000)
  // Shared data is intentionally read only through the IVAO-session-protected API.
  // A short poll replaces public Supabase Postgres Changes access.
  const refreshTimer = window.setInterval(() => void refresh(), 5_000)

  return () => {
    disposed = true
    void disposed
    workspaceWriteTimers.forEach((timer) => window.clearTimeout(timer))
    flightWriteTimers.forEach((timer) => window.clearTimeout(timer))
    window.clearInterval(applyTimer)
    window.clearInterval(refreshTimer)
    document.removeEventListener('change', onChange)
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('dblclick', onDoubleClick)
    window.removeEventListener('aman:force-shared-refresh', onForceRefresh)
    window.removeEventListener('aman:realtime-manual-release', onRealtimeManualRelease)
    window.removeEventListener('aman:realtime-manual-release-cancel', onRealtimeManualReleaseCancel)
    window.removeEventListener('aman:realtime-flight-state', onRealtimeFlightState)
    window.removeEventListener('aman:realtime-sequence-order', onRealtimeSequenceOrder)
  }
}
