export type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_LANDING_MINUTES = 4

function parseHmNearNow(value: string, now: Date) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    minute,
    0,
    0,
  )

  const candidates = [base - 86_400_000, base, base + 86_400_000]
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - now.getTime()) < Math.abs(best - now.getTime()) ? candidate : best,
  candidates[0])
}

function forwardMinutes(fromHm: string, toHm: string) {
  const from = fromHm.match(/^(\d{2}):(\d{2})$/)
  const to = toHm.match(/^(\d{2}):(\d{2})$/)
  if (!from || !to) return null

  const fromMinutes = Number(from[1]) * 60 + Number(from[2])
  const toMinutes = Number(to[1]) * 60 + Number(to[2])
  if (!Number.isFinite(fromMinutes) || !Number.isFinite(toMinutes)) return null

  const diff = (toMinutes - fromMinutes + 24 * 60) % (24 * 60)
  return diff <= 180 ? diff : null
}

function rowFlightStatus(row: HTMLElement, now: Date): AmanFlightStatus {
  const title = row.getAttribute('title') || ''
  const predictedMatch = title.match(/Predicted IAWP\s+(\d{2}:\d{2})Z/i)
  const cells = row.children
  const tldt = cells.item(0)?.textContent?.trim() || ''
  const tto = cells.item(4)?.textContent?.trim() || ''

  const predictedIawpMs = predictedMatch ? parseHmNearNow(predictedMatch[1], now) : null
  const nominalMinutes = forwardMinutes(tto, tldt)
  const manualStable = row.classList.contains('is-stable')

  if (predictedIawpMs == null) return manualStable ? 'STABLE' : 'UNSTABLE'

  const minutesToIawp = (predictedIawpMs - now.getTime()) / 60_000
  const predictedLandingMs = nominalMinutes == null
    ? null
    : predictedIawpMs + nominalMinutes * 60_000
  const minutesToLanding = predictedLandingMs == null
    ? Number.POSITIVE_INFINITY
    : (predictedLandingMs - now.getTime()) / 60_000

  if (minutesToLanding <= FROZEN_BEFORE_LANDING_MINUTES) return 'FROZEN'
  if (minutesToIawp <= SUPERSTABLE_BEFORE_IAWP_MINUTES) return 'SUPERSTABLE'
  if (manualStable || minutesToIawp <= STABLE_BEFORE_IAWP_MINUTES) return 'STABLE'
  return 'UNSTABLE'
}

function applyStatusClass(element: HTMLElement, status: AmanFlightStatus) {
  const className = `status-${status.toLowerCase()}`
  if (element.dataset.flightStatus === status) return

  element.classList.remove(
    'status-unstable',
    'status-stable',
    'status-superstable',
    'status-frozen',
  )
  element.classList.add(className)
  element.dataset.flightStatus = status
}

function refreshFlightStatuses() {
  const now = new Date()
  const byCallsign = new Map<string, AmanFlightStatus>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
    const status = rowFlightStatus(row, now)
    applyStatusClass(row, status)

    const callsign = row.querySelector('strong')?.textContent?.trim()
    if (callsign) byCallsign.set(callsign, status)
  })

  document.querySelectorAll<HTMLElement>('.aman-inbound-row').forEach((row) => {
    const callsignElement = row.querySelector<HTMLElement>('strong')
    if (!callsignElement) return
    const callsign = callsignElement.textContent?.trim() || ''
    const status = byCallsign.get(callsign) || 'UNSTABLE'
    applyStatusClass(callsignElement, status)
  })
}

export function installFlightStatusRuntime() {
  refreshFlightStatuses()
  const timer = window.setInterval(refreshFlightStatuses, 1_000)
  return () => window.clearInterval(timer)
}
