function updateManualLabels() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row, .aman-inbound-row').forEach((element) => {
    const title = element.getAttribute('title')
    if (!title) return
    const next = title
      .replaceAll('ATC manual / Stable', 'ATC MANUAL TARGET')
      .replaceAll('ATC MANUAL / STABLE', 'ATC MANUAL TARGET')
    if (next !== title) element.setAttribute('title', next)
  })

  document.querySelectorAll<HTMLElement>('.aman-status-list dt').forEach((label) => {
    if (label.textContent?.trim() === 'Manual stable') label.textContent = 'Manual target'
  })
}

function updateInteractionHint() {
  const hint = document.querySelector<HTMLElement>('.is-drag-enabled')
  if (hint) hint.textContent = 'DRAG UP = PUSH / CASCADE · DRAG DOWN PAST CALLSIGN = REORDER · DBL CLICK = AUTO · RIGHT CLICK = OPS'
}

export function installFlightStatusRuntime() {
  updateInteractionHint()
  updateManualLabels()

  const uiTimer = window.setInterval(() => {
    updateInteractionHint()
    updateManualLabels()
  }, 1_000)

  return () => {
    window.clearInterval(uiTimer)
  }
}
