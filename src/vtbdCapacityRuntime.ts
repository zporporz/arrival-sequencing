import { AMAN_REFERENCE_SPEED_KT } from './core/amanConstants'

const ARRIVAL_MODES = new Set(['ARR', 'MIX'])
const CAPACITY_REFRESH_MS = 1000

function vtbdConfigBlock() {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-runway-config-block')).find((block) => {
    const label = block.querySelector<HTMLElement>('.aman-profile-select span')?.textContent?.trim().toUpperCase()
    return label === 'VTBD CONFIG'
  }) ?? null
}

function vtbdSingleStreamCapacityPerHour() {
  const block = vtbdConfigBlock()
  if (!block) return null

  const activeRunwayCapacities = Array.from(block.querySelectorAll<HTMLElement>('.aman-runway-card')).flatMap((card) => {
    const mode = card.querySelector<HTMLSelectElement>('select')?.value?.trim().toUpperCase()
    if (!mode || !ARRIVAL_MODES.has(mode)) return []

    const spacingNm = Number(card.querySelector<HTMLInputElement>('input[type="number"]')?.value)
    if (!Number.isFinite(spacingNm) || spacingNm <= 0) return []

    return [AMAN_REFERENCE_SPEED_KT / spacingNm]
  })

  if (!activeRunwayCapacities.length) return 0

  // VTBD 21R/21L are modelled by this AMAN as one airport-wide landing stream.
  // Cross-runway arrivals therefore cannot be counted as simultaneous independent
  // runway throughput. The stream ceiling is the fastest active follower spacing,
  // not the sum of the individual runway rates.
  return Math.max(0, Math.floor(Math.max(...activeRunwayCapacities)))
}

function correctedCapacityLabel(capacity: number) {
  return capacity > 0 ? String(capacity) : '--'
}

function replaceBdCapacity(text: string, capacity: number) {
  const label = correctedCapacityLabel(capacity)
  return text.replace(/\bBD\s+(\d+)\/(?:\d+|--)/, `BD $1/${label}`)
}

function readBdDemand(text: string) {
  const match = text.match(/\bBD\s+(\d+)\/(?:\d+|--)/)
  return match ? Number(match[1]) : null
}

function updateCapacityText(capacity: number) {
  document.querySelectorAll<HTMLElement>('.aman-capacity-chip').forEach((element) => {
    const current = element.textContent || ''
    const next = replaceBdCapacity(current, capacity)
    if (next !== current) element.textContent = next
  })

  document.querySelectorAll<HTMLElement>('.aman-status-list > div').forEach((row) => {
    const key = row.querySelector<HTMLElement>('dt')?.textContent?.trim().toUpperCase()
    if (key !== 'AAR / DEMAND') return
    const value = row.querySelector<HTMLElement>('dd')
    if (!value) return
    const current = value.textContent || ''
    const next = replaceBdCapacity(current, capacity)
    if (next !== current) value.textContent = next
  })
}

function updateCapacityOverload(capacity: number) {
  const chip = document.querySelector<HTMLElement>('.aman-capacity-chip')
  const demand = chip ? readBdDemand(chip.textContent || '') : null
  const overloaded = demand != null && capacity > 0 && demand > capacity
  const meta = document.querySelector<HTMLElement>('.aman-panel-meta')
  if (!meta) return

  let runtimeAlert = meta.querySelector<HTMLElement>('[data-vtbd-capacity-alert="true"]')
  if (overloaded && !runtimeAlert) {
    runtimeAlert = document.createElement('span')
    runtimeAlert.className = 'aman-capacity-alert'
    runtimeAlert.dataset.vtbdCapacityAlert = 'true'
    runtimeAlert.textContent = 'OVERLOAD'
    const chipElement = meta.querySelector('.aman-capacity-chip')
    if (chipElement) meta.insertBefore(runtimeAlert, chipElement)
    else meta.appendChild(runtimeAlert)
  } else if (!overloaded && runtimeAlert) {
    runtimeAlert.remove()
  }
}

function applyVtbdCapacityCorrection() {
  const capacity = vtbdSingleStreamCapacityPerHour()
  if (capacity == null) return
  updateCapacityText(capacity)
  updateCapacityOverload(capacity)
}

export function installVtbdCapacityRuntime() {
  let disposed = false
  let scheduled = false

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) applyVtbdCapacityCorrection()
    })
  }

  applyVtbdCapacityCorrection()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  const timer = window.setInterval(schedule, CAPACITY_REFRESH_MS)

  return () => {
    disposed = true
    observer.disconnect()
    window.clearInterval(timer)
    document.querySelectorAll<HTMLElement>('[data-vtbd-capacity-alert="true"]').forEach((element) => element.remove())
  }
}
