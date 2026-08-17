const TARGET_GAP_MINUTES = 2
const TLDT_SELECTOR = 'tbody input.cell-input.time.strong'
const CONFLICT_CLASS = 'spacing-conflict-cell'
const SPACING_CLASS = 'spacing-gap-cell'
const EXACT_CLASS = 'same-cldt-conflict'
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
}

function parseClock(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function circularGap(leftMinutes: number, rightMinutes: number) {
  const direct = Math.abs(leftMinutes - rightMinutes)
  return Math.min(direct, 1440 - direct)
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
  cell.classList.remove(CONFLICT_CLASS, SPACING_CLASS, EXACT_CLASS, ORDER_CLASS)
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

  const { partner, gapMinutes } = conflict
  const relationship = gapMinutes === 0 ? 'SAME TLDT' : `GAP ${gapMinutes}m`
  const warningLabel = `↔ SEQ ${partner.sequence} ${partner.callsign} · ${relationship}`
  const title = gapMinutes === 0
    ? `Same TLDT as SEQ ${partner.sequence} ${partner.callsign}. Adjust the landing plan as required.`
    : `${gapMinutes}-minute TLDT gap with SEQ ${partner.sequence} ${partner.callsign}. This is below the ${TARGET_GAP_MINUTES}-minute planning target.`

  cell.classList.add(CONFLICT_CLASS, SPACING_CLASS)
  if (gapMinutes === 0) cell.classList.add(EXACT_CLASS)
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
) {
  const existing = conflicts.get(item.input)
  if (existing && existing.gapMinutes <= gapMinutes) return
  conflicts.set(item.input, { gapMinutes, partner })
}

function recalculateSpacing() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(TLDT_SELECTOR))

  for (const input of inputs) clearConflict(input)

  const activeItems: SpacingItem[] = inputs
    .filter(isActiveForSpacing)
    .map((input) => {
      const minutes = parseClock(input.value.trim())
      if (minutes === null) return null
      const meta = rowMeta(input)
      return { input, minutes, sequence: meta.sequence, callsign: meta.callsign }
    })
    .filter((item): item is SpacingItem => item !== null)

  const conflicts = new Map<HTMLInputElement, Conflict>()

  // Compare every active flight against every other active flight. TLDT sequence numbers
  // can temporarily place a later row between two flights with the same time, so only
  // checking adjacent table rows misses real conflicts such as SEQ 1 03:14 / SEQ 3 03:14.
  // circularGap also treats 23:59 / 00:00 as a one-minute gap.
  for (let leftIndex = 0; leftIndex < activeItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeItems.length; rightIndex += 1) {
      const left = activeItems[leftIndex]
      const right = activeItems[rightIndex]
      const gapMinutes = circularGap(left.minutes, right.minutes)

      if (gapMinutes < TARGET_GAP_MINUTES) {
        setNearestConflict(conflicts, left, right, gapMinutes)
        setNearestConflict(conflicts, right, left, gapMinutes)
      }
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
    if (target instanceof HTMLInputElement && target.matches(TLDT_SELECTOR)) schedule()
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
