// Existing flight-status and speed-advisory runtimes read the historical
// `Predicted IAWP HH:MMZ` row-title token. MAESTRO v2.4 exposes the same event
// operationally as ETA-FF. Keep both tokens during the transition so the source-backed
// HMI terminology can change without breaking lifecycle/advisory calculations.

function decorateRow(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  if (!title.includes('ETA-FF') || title.includes('Predicted IAWP')) return
  const match = title.match(/ETA-FF\s+(\d{2}:\d{2})Z/i)
  if (!match) return
  row.setAttribute('title', `Predicted IAWP ${match[1]}Z · ${title}`)
}

function decorateAll() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(decorateRow)
}

export function installMaestroV24CompatRuntime() {
  decorateAll()

  const observer = new MutationObserver(() => decorateAll())
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  })

  const timer = window.setInterval(decorateAll, 500)
  return () => {
    observer.disconnect()
    window.clearInterval(timer)
  }
}
