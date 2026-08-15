const TARGET_GAP_MINUTES = 2
const CLDT_SELECTOR = 'tbody input.cell-input.time.strong'
const CONFLICT_CLASS = 'spacing-conflict-cell'

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

function displayGap(deltaMinutes: number) {
  if (deltaMinutes < 0) return `-${Math.abs(deltaMinutes)}m`
  return `${deltaMinutes}m`
}

function clearConflict(input: HTMLInputElement) {
  const cell = input.closest('td')
  if (!cell) return
  cell.classList.remove(CONFLICT_CLASS)
  cell.removeAttribute('data-spacing-warning')
  cell.removeAttribute('title')
}

function applyConflict(input: HTMLInputElement, gapMinutes: number, minimumClock: string) {
  const cell = input.closest('td')
  if (!cell) return
  const label = `GAP ${displayGap(gapMinutes)} · MIN ${minimumClock}`
  cell.classList.add(CONFLICT_CLASS)
  cell.setAttribute('data-spacing-warning', label)
  cell.setAttribute('title', `${label} — 2-minute planning target, not a universal separation minimum`)
}

function recalculateSpacing() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(CLDT_SELECTOR))

  for (const input of inputs) clearConflict(input)

  let previousMinutes: number | null = null

  for (const input of inputs) {
    const currentMinutes = parseClock(input.value)
    if (currentMinutes === null) {
      previousMinutes = null
      continue
    }

    if (previousMinutes !== null) {
      let gapMinutes = currentMinutes - previousMinutes
      if (gapMinutes < -720) gapMinutes += 1440

      if (gapMinutes < TARGET_GAP_MINUTES) {
        applyConflict(input, gapMinutes, formatClock(previousMinutes + TARGET_GAP_MINUTES))
      }
    }

    previousMinutes = currentMinutes
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
