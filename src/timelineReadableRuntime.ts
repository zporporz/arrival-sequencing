function roundOperationalMinute(value: number) {
  if (!Number.isFinite(value)) return 0
  const magnitude = Math.round(Math.abs(value))
  if (magnitude === 0) return 0
  return value < 0 ? -magnitude : magnitude
}

function roundHmsToHm(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null

  const roundedMinutes = (hour * 60 + minute + (second >= 30 ? 1 : 0)) % (24 * 60)
  return `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(roundedMinutes % 60).padStart(2, '0')}`
}

function decorateRow(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const tldtCell = row.querySelector<HTMLElement>(':scope > .tldt')
  const tldtMatch = title.match(/STA\/TLDT\s+(\d{2}:\d{2}:\d{2})Z/i)
  const roundedTldt = tldtMatch ? roundHmsToHm(tldtMatch[1]) : null
  if (tldtCell && roundedTldt && tldtCell.textContent !== roundedTldt) {
    tldtCell.textContent = roundedTldt
  }

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
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] })
  const timer = window.setInterval(decorateAll, 1_000)

  return () => {
    disposed = true
    observer.disconnect()
    window.clearInterval(timer)
  }
}
