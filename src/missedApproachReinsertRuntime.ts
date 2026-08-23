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
}

type PendingReinsert = {
  airport: 'VTBD' | 'VTBS'
  callsign: string
  targetMs: number
  expiresAt: number
}

const MISSED_REINSERT_OFFSET_MS = 10 * 60_000
const LOGICAL_PX_PER_MINUTE = 10
const POINTER_ID = 70426
const pending = new Map<string, PendingReinsert>()

function key(airport: string, callsign: string) {
  return `${airport}:${callsign}`
}

function reactProps<T>(element: Element): T | null {
  const propKey = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!propKey) return null
  return (element as unknown as Record<string, unknown>)[propKey] as T
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

function parseClockNearNow(value: string, nowMs: number) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const now = new Date(nowMs)
  const candidate = new Date(now)
  candidate.setUTCHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0)
  const delta = candidate.getTime() - nowMs
  if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function rowIdentity(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : null
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  return airport && callsign ? { airport, callsign } : null
}

function currentTargetMs(row: HTMLElement) {
  const nowMs = Date.now()
  const title = row.getAttribute('title') || ''
  const fullClock = title.match(/STA\/TLDT\s+(\d{2}:\d{2}(?::\d{2})?)Z/i)?.[1]
  if (fullClock) return parseClockNearNow(fullClock, nowMs)

  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  if (Number.isFinite(offsetPx)) return nowMs - offsetPx / LOGICAL_PX_PER_MINUTE * 60_000

  const clock = row.querySelector<HTMLElement>('.tldt')?.textContent?.trim() || ''
  return parseClockNearNow(clock, nowMs)
}

function applyTarget(row: HTMLElement, targetMs: number) {
  const currentMs = currentTargetMs(row)
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false

  const deltaMinutes = (targetMs - currentMs) / 60_000
  const y = -deltaMinutes * LOGICAL_PX_PER_MINUTE
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(y))
  props.onPointerUp(fakePointer(y))
  return true
}

function rowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || null
}

async function persistTarget(item: PendingReinsert, runway: string) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      action: 'setMissedApproachTarget',
      serviceDate: new Date().toISOString().slice(0, 10),
      airport: item.airport,
      callsign: item.callsign,
      manualTldt: new Date(item.targetMs).toISOString(),
      manualRunway: runway,
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `AMAN API returned ${response.status}`)
  }
}

function captureMissedReinsert(event: MouseEvent) {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest<HTMLButtonElement>('.aman-reinsert-button.is-missed')
  if (!button) return
  const inboundRow = button.closest<HTMLElement>('.aman-inbound-row')
  if (!inboundRow) return

  const airportText = inboundRow.querySelector<HTMLElement>('.apt')?.textContent?.trim().toUpperCase()
  const airport = airportText === 'BD' ? 'VTBD' : airportText === 'BS' ? 'VTBS' : null
  const callsign = inboundRow.querySelector<HTMLElement>('.aman-inbound-acid strong')?.textContent?.trim().toUpperCase() || ''
  if (!airport || !callsign) return

  const targetMs = Date.now() + MISSED_REINSERT_OFFSET_MS
  pending.set(key(airport, callsign), {
    airport,
    callsign,
    targetMs,
    expiresAt: Date.now() + 15_000,
  })
}

function scanPending() {
  const now = Date.now()
  for (const [pendingKey, item] of pending) {
    if (now > item.expiresAt) {
      pending.delete(pendingKey)
      continue
    }

    const row = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row')).find((candidate) => {
      const identity = rowIdentity(candidate)
      return identity?.airport === item.airport && identity.callsign === item.callsign
    })
    if (!row) continue

    const runway = rowRunway(row)
    if (!runway || !applyTarget(row, item.targetMs)) continue

    row.dataset.missedReinsertTarget = new Date(item.targetMs).toISOString()
    pending.delete(pendingKey)
    void persistTarget(item, runway).catch((error) => console.error('Missed approach +10 reinsert persistence failed', error))
  }
}

export function installMissedApproachReinsertRuntime() {
  let disposed = false
  let scheduled = false

  const schedule = () => {
    if (disposed || scheduled || !pending.size) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) scanPending()
    })
  }

  document.addEventListener('click', captureMissedReinsert, true)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  const timer = window.setInterval(() => { if (!disposed && pending.size) scanPending() }, 100)

  return () => {
    disposed = true
    document.removeEventListener('click', captureMissedReinsert, true)
    observer.disconnect()
    window.clearInterval(timer)
    pending.clear()
  }
}
