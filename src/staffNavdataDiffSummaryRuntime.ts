function readDiffValue(label: string) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.navadmin-diff-grid > div'))
  const row = rows.find((item) => item.querySelector('span')?.textContent?.trim().toUpperCase() === label)
  const value = Number(row?.querySelector('strong')?.textContent?.trim())
  return Number.isFinite(value) ? value : 0
}

function selectedCycleStatus() {
  const badge = document.querySelector<HTMLElement>('.navadmin-card .navadmin-card-head b[class*="status-"]')
  return badge?.textContent?.trim().toUpperCase() || null
}

function applyDiffSummary() {
  const cards = document.querySelectorAll<HTMLElement>('.navadmin-summary-grid > article')
  const card = cards.item(1)
  if (!card) return

  const label = card.querySelector<HTMLElement>('span')
  const value = card.querySelector<HTMLElement>('strong')
  const detail = card.querySelector<HTMLElement>('small')
  if (!label || !value || !detail) return

  label.textContent = 'CHANGES FROM ACTIVE'

  const activeCycle = cards.item(0)?.querySelector('strong')?.textContent?.trim().toUpperCase()
  const status = selectedCycleStatus()
  const diffGrid = document.querySelector('.navadmin-diff-grid')

  if (!activeCycle || activeCycle === 'NONE') {
    value.textContent = 'BASELINE'
    detail.textContent = 'No previous active AIRAC to compare'
    return
  }

  if (status === 'ACTIVE') {
    value.textContent = '0'
    detail.textContent = 'Selected cycle is the active baseline'
    return
  }

  if (!diffGrid) {
    value.textContent = '—'
    detail.textContent = 'Select a staged cycle to compare'
    return
  }

  const added = readDiffValue('ADDED')
  const changed = readDiffValue('CHANGED')
  const removed = readDiffValue('REMOVED')
  const total = added + changed + removed

  value.textContent = String(total)
  detail.textContent = `+${added} added · ${changed} changed · -${removed} removed`
}

export function installStaffNavdataDiffSummaryRuntime() {
  let disposed = false
  let scheduled = false

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      if (!disposed) applyDiffSummary()
    })
  }

  schedule()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
  }
}
