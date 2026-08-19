type SharedFlightState = {
  service_date?: string
  airport?: string
  callsign?: string
  connection_phase?: string
  target_mode?: 'AUTO' | 'MANUAL'
  manual_tldt?: string | null
  manual_runway?: string | null
  revision?: number
}

type SharedStateDetail = {
  flightStates?: SharedFlightState[]
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

type ReactRowProps = {
  onPointerDown?: (event: FakePointerEvent) => void
  onPointerMove?: (event: FakePointerEvent) => void
  onPointerUp?: (event: FakePointerEvent) => void
  onDoubleClick?: () => void
}

type ReactChangeProps = {
  onChange?: (event: { target: HTMLSelectElement }) => void
}

const SHARED_STATE_EVENT = 'aman:shared-state'
const PX_PER_MINUTE = 10
const POINTER_ID = 70422

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function flightKey(airport: string, callsign: string) {
  return `${airport.trim().toUpperCase()}:${callsign.trim().toUpperCase()}`
}

function rowIdentity(row: HTMLElement) {
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  return airport && callsign ? flightKey(airport, callsign) : ''
}

function findFlightRow(airport: string, callsign: string) {
  const key = flightKey(airport, callsign)
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row'))
    .find((row) => rowIdentity(row) === key) ?? null
}

function currentTargetMs(row: HTMLElement) {
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return Date.now() - offsetPx / PX_PER_MINUTE * 60_000
  return null
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

function invokeRunwayChange(select: HTMLSelectElement, runway: string) {
  if (!runway || select.value === runway) return
  select.value = runway
  reactProps<ReactChangeProps>(select)?.onChange?.({ target: select })
}

function applyTarget(row: HTMLElement, targetMs: number) {
  const currentMs = currentTargetMs(row)
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false
  const deltaMinutes = (targetMs - currentMs) / 60_000
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  props.onPointerUp(fakePointer(-deltaMinutes * PX_PER_MINUTE))
  return true
}

function applySharedFlight(state: SharedFlightState) {
  const airport = String(state.airport || '').trim().toUpperCase()
  const callsign = String(state.callsign || '').trim().toUpperCase()
  if (!airport || !callsign || state.connection_phase === 'EXPIRED') return

  const row = findFlightRow(airport, callsign)
  if (!row || row.classList.contains('is-dragging')) return

  const revision = Number(state.revision)
  const revisionKey = Number.isFinite(revision) ? String(revision) : ''
  if (revisionKey && row.dataset.manualSyncCompatRevision === revisionKey) return

  const props = reactProps<ReactRowProps>(row)
  if (state.target_mode === 'AUTO') {
    const isManual = row.classList.contains('is-stable') || row.querySelector('.runway-assignment.is-manual') != null
    if (isManual) props?.onDoubleClick?.()
    if (revisionKey) row.dataset.manualSyncCompatRevision = revisionKey
    return
  }

  if (state.target_mode !== 'MANUAL' || !state.manual_tldt || !state.manual_runway) return
  const targetMs = new Date(state.manual_tldt).getTime()
  if (!Number.isFinite(targetMs)) return

  const runwaySelect = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (runwaySelect) invokeRunwayChange(runwaySelect, state.manual_runway.trim().toUpperCase())

  window.requestAnimationFrame(() => {
    const currentRow = findFlightRow(airport, callsign)
    if (!currentRow) return
    const currentMs = currentTargetMs(currentRow)
    if (currentMs == null || Math.abs(currentMs - targetMs) > 2_000 || !currentRow.classList.contains('is-stable')) {
      applyTarget(currentRow, targetMs)
    }
    if (revisionKey) currentRow.dataset.manualSyncCompatRevision = revisionKey
  })
}

function normalizeTimelineMinuteLabels() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row .tldt').forEach((label) => {
    const text = label.textContent?.trim() || ''
    const match = text.match(/^(\d{2}:\d{2}):\d{2}$/)
    if (match && label.textContent !== match[1]) label.textContent = match[1]
  })
}

export function installManualTargetSyncCompatRuntime() {
  const latestFlights = new Map<string, SharedFlightState>()

  const rememberAndApply = (state: SharedFlightState) => {
    const airport = String(state.airport || '').trim().toUpperCase()
    const callsign = String(state.callsign || '').trim().toUpperCase()
    if (!airport || !callsign) return
    latestFlights.set(flightKey(airport, callsign), state)
    applySharedFlight(state)
  }

  const onSharedState = (event: Event) => {
    const detail = (event as CustomEvent<SharedStateDetail>).detail
    detail?.flightStates?.forEach(rememberAndApply)
  }

  window.addEventListener(SHARED_STATE_EVENT, onSharedState)

  const minuteObserver = new MutationObserver(() => normalizeTimelineMinuteLabels())
  minuteObserver.observe(document.body, { subtree: true, childList: true, characterData: true })
  normalizeTimelineMinuteLabels()

  // Shared state is often fetched before live traffic rows finish rendering after a refresh.
  // Keep the latest persisted flight rows and re-apply them once the matching timeline row exists.
  const retryTimer = window.setInterval(() => {
    normalizeTimelineMinuteLabels()
    latestFlights.forEach(applySharedFlight)
  }, 1_000)

  return () => {
    window.removeEventListener(SHARED_STATE_EVENT, onSharedState)
    minuteObserver.disconnect()
    window.clearInterval(retryTimer)
    latestFlights.clear()
  }
}
