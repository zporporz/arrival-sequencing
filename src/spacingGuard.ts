const TARGET_GAP_MINUTES = 2
const CLDT_SELECTOR = 'tbody input.cell-input.time.strong'
const CONFLICT_CLASS = 'spacing-conflict-cell'
const SPACING_CLASS = 'spacing-gap-cell'
const ORDER_CLASS = 'order-conflict-cell'
const BADGE_CLASS = 'spacing-warning-badge'

type SpacingItem = {
  input: HTMLInputElement
  minutes: number
  sequence: string
  callsign: string
}

type Conflict = {
  gapMinutes: number
  partner: SpacingItem
  minimumClock: string
}

function parseClock(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function formatClock(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function rowMeta(input: HTMLInputElement) {
  const row = input.closest('tr')
  const sequence = row?.querySelector<HTMLElement>('.seq-cell')?.textContent?.trim() || '?'
  const callsign = row?.querySelector<HTMLInputElement>('td:nth-child(2) input')?.value.trim()
    || row?.querySelector<HTMLElement>('td:nth-child(2)')?.textContent?.trim()
    || 'FLIGHT'
  return { sequence, callsign }
}

function clearConflict(input: HTMLInputElement) {
  const cell = input.closest('td')
  if (!cell) return
  cell.classList.remove(CONFLICT_CLASS, SPACING_CLASS, ORDER_CLASS)
  cell.removeAttribute('data-spacing-warning')
  cell.removeAttribute('title')
  cell.querySelector(`.${BADGE_CLASS}`)?.remove()
}

function isActiveForSpacing(input: HTMLInputElement) {
  const row = input.closest('tr')
  const status = row?.querySelector<HTMLSelectElement>('.status-select')?.value
  return status !== 'LANDED' && status !== 'CANCELLED'
}

function applySpacingConflict(input: HTMLInputElement, conflict: Conflict) {
  const cell = input.closest('td')
  if (!cell) return

  const { partner, gapMinutes, minimumClock } = conflict
  const relationship = gapMinutes === 0 ? 'SAME CLDT' : `GAP ${gapMinutes}m`
  const warningLabel = `↔ SEQ ${partner.sequence} ${partner.callsign} · ${relationship}`
  const title = gapMinutes === 0
    ? `Same CLDT as SEQ ${partner.sequence} ${partner.callsign}. Adjust the landing plan as required.`
    : `${gapMinutes}-minute CLDT gap with SEQ ${partner.sequence} ${partner.callsign}. Planning target is ${TARGET_GAP_MINUTES} minutes; earliest target from the earlier flight is ${minimumClock}.`

  cell.classList.add(CONFLICT_CLASS, SPACING_CLASS)
  cell.setAttribute('data-spacing-warning', warningLabel)
  cell.setAttribute('title', title)
  cell.style.position = 'relative'

  let badge = cell.querySelector<HTMLSpanElement>(`.${BADGE_CLASS}`)
  if (!badge) {
    badge = document.createElement('span')
    badge.className = BADGE_CLASS
    cell.appendChild(badge)
  }
  badge.textContent = warningLabel
}

function setNearestConflict(
  conflicts: Map<HTMLInputElement, Conflict>,
  item: SpacingItem,
  partner: SpacingItem,
  gapMinutes: number,
  minimumClock: string,
) {
  const existing = conflicts.get(item.input)
  if (existing && existing.gapMinutes <= gapMinutes) return
  conflicts.set(item.input, { gapMinutes, partner, minimumClock })
}

function recalculateSpacing() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(CLDT_SELECTOR))

  for (const input of inputs) clearConflict(input)

  // Rows are already ordered by the database sequence (which follows the full CLDT timestamp).
  // Preserve that order instead of sorting only by HH:MM, then unwrap midnight so 23:59 → 00:00
  // is treated as a one-minute gap rather than almost 24 hours apart.
  const ordered: SpacingItem[] = []
  let previousUnwrapped: number | null = null

  for (const input of inputs.filter(isActiveForSpacing)) {
    const rawMinutes = parseClock(input.value.trim())
    if (rawMinutes === null) continue

    let minutes = rawMinutes
    if (previousUnwrapped !== null) {
      while (minutes < previousUnwrapped - 720) minutes += 1440
    }

    const meta = rowMeta(input)
    ordered.push({ input, minutes, sequence: meta.sequence, callsign: meta.callsign })
    previousUnwrapped = minutes
  }

  const conflicts = new Map<HTMLInputElement, Conflict>()

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const gapMinutes = current.minutes - previous.minutes

    if (gapMinutes >= 0 && gapMinutes < TARGET_GAP_MINUTES) {
      const minimumClock = formatClock(previous.minutes + TARGET_GAP_MINUTES)
      setNearestConflict(conflicts, current, previous, gapMinutes, minimumClock)
      setNearestConflict(conflicts, previous, current, gapMinutes, minimumClock)
    }
  }

  for (const [input, conflict] of conflicts) applySpacingConflict(input, conflict)
}

export function installSpacingGuard() {
  let frame = 0
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(recalculateSpacing)
  }

  document.addEventListener('input', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.matches(CLDT_SELECTOR)) schedule()
  }, true)

  document.addEventListener('change', schedule, true)
  document.addEventListener('focusout', schedule, true)

  const start = () => {
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['value'],
    })

    window.setInterval(schedule, 500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
