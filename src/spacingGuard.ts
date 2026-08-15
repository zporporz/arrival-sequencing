const TARGET_GAP_MINUTES = 2
const CLDT_SELECTOR = 'tbody input.cell-input.time.strong'
const CONFLICT_CLASS = 'spacing-conflict-cell'
const SPACING_CLASS = 'spacing-gap-cell'
const ORDER_CLASS = 'order-conflict-cell'
const BADGE_CLASS = 'spacing-warning-badge'

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

function clearConflict(input: HTMLInputElement) {
  const cell = input.closest('td')
  if (!cell) return
  cell.classList.remove(CONFLICT_CLASS, SPACING_CLASS, ORDER_CLASS)
  cell.removeAttribute('data-spacing-warning')
  cell.removeAttribute('title')
  cell.querySelector(`.${BADGE_CLASS}`)?.remove()
}

function applySpacingConflict(input: HTMLInputElement, gapMinutes: number, minimumClock: string) {
  const cell = input.closest('td')
  if (!cell) return

  const warningLabel = `⚠ SPACING · GAP ${gapMinutes}m · MIN ${minimumClock}`
  cell.classList.add(CONFLICT_CLASS, SPACING_CLASS)
  cell.setAttribute('data-spacing-warning', warningLabel)
  cell.setAttribute('title', `${warningLabel} — below the ${TARGET_GAP_MINUTES}-minute planning target, not a universal separation minimum.`)
  cell.style.position = 'relative'

  let badge = cell.querySelector<HTMLSpanElement>(`.${BADGE_CLASS}`)
  if (!badge) {
    badge = document.createElement('span')
    badge.className = BADGE_CLASS
    cell.appendChild(badge)
  }
  badge.textContent = warningLabel
}

function recalculateSpacing() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(CLDT_SELECTOR))

  for (const input of inputs) clearConflict(input)

  const ordered = inputs
    .map((input) => ({ input, minutes: parseClock(input.value.trim()) }))
    .filter((item): item is { input: HTMLInputElement; minutes: number } => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes)

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const gapMinutes = current.minutes - previous.minutes

    if (gapMinutes < TARGET_GAP_MINUTES) {
      applySpacingConflict(
        current.input,
        gapMinutes,
        formatClock(previous.minutes + TARGET_GAP_MINUTES),
      )
    }
  }
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

    // React/Supabase realtime can update value properties without a DOM attribute mutation.
    // Re-checking twice per second is tiny for this small table and keeps the warning deterministic.
    window.setInterval(schedule, 500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
