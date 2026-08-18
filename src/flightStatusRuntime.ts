export type AmanFlightStatus = 'UNSTABLE' | 'STABLE' | 'SUPERSTABLE' | 'FROZEN'

const STABLE_BEFORE_IAWP_MINUTES = 15
const SUPERSTABLE_BEFORE_IAWP_MINUTES = 5
const FROZEN_BEFORE_LANDING_MINUTES = 4
const PX_PER_MINUTE = 10

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
  const cells = row.children
  const tldtHm = cells.item(0)?.textContent?.trim() || ''
  const ttoHm = cells.item(4)?.textContent?.trim() || ''
  const delayText = cells.item(5)?.textContent?.trim() || ''
  const offsetPx = Number.parseFloat(row.style.getPropertyValue('--offset-px'))
  const delayMinutes = Number.parseFloat(delayText)
  const nominalMinutes = forwardMinutes(ttoHm, tldtHm)
  const manualStable = row.classList.contains('is-stable')

  if (!Number.isFinite(offsetPx) || !Number.isFinite(delayMinutes) || nominalMinutes == null) {
    return manualStable ? 'STABLE' : 'UNSTABLE'
  }

  // The row is positioned from TLDT with 10 px/minute. Reconstructing TLDT from the
  // timeline position preserves roughly six-second precision, then use the displayed
  // Delay Required to recover the current predicted IAWP time.
  const targetTldtMs = now.getTime() - (offsetPx / PX_PER_MINUTE) * 60_000
  const targetTtoMs = targetTldtMs - nominalMinutes * 60_000
  const predictedIawpMs = targetTtoMs - delayMinutes * 60_000
  const predictedLandingMs = predictedIawpMs + nominalMinutes * 60_000

  const minutesToIawp = (predictedIawpMs - now.getTime()) / 60_000
  const minutesToLanding = (predictedLandingMs - now.getTime()) / 60_000

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
