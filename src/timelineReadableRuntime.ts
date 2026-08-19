function roundOperationalMinute(value: number) {
  if (!Number.isFinite(value)) return 0
  const magnitude = Math.round(Math.abs(value))
  if (magnitude === 0) return 0
  return value < 0 ? -magnitude : magnitude
}

function decorateRow(row: HTMLElement) {
  const delayCell = row.children.item(5) as HTMLElement | null
  if (!delayCell) return

  const primary = delayCell.querySelector<HTMLElement>(':scope > span')
  const raw = Number.parseFloat(primary?.textContent?.trim() || '')
  if (!Number.isFinite(raw)) return

  const rounded = roundOperationalMinute(raw)
  const label = rounded > 0 ? `+${rounded}` : String(rounded)
  if (delayCell.dataset.roundedDelay !== label) delayCell.dataset.roundedDelay = label
}

function decorateAll() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(decorateRow)
}

export function installTimelineReadableRuntime() {
  let scheduled = false
  let disposed = false

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) decorateAll()
    })
  }

  decorateAll()

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const timer = window.setInterval(decorateAll, 1_000)

  return () => {
    disposed = true
    observer.disconnect()
    window.clearInterval(timer)
  }
}
