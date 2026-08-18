function statusValue(panel: HTMLElement, label: string) {
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.aman-status-list > div'))
  for (const row of rows) {
    const dt = row.querySelector<HTMLElement>('dt')?.textContent?.trim().toUpperCase()
    if (dt === label.toUpperCase()) return row.querySelector<HTMLElement>('dd')?.textContent?.trim() || '--'
  }
  return '--'
}

function ensureSystemSummary(panel: HTMLElement) {
  let button = panel.querySelector<HTMLButtonElement>(':scope > .aman-system-summary')
  if (button) return button

  button = document.createElement('button')
  button.type = 'button'
  button.className = 'aman-system-summary'
  button.setAttribute('aria-expanded', 'false')
  button.innerHTML = '<span class="title">SYSTEM</span><span class="health"></span><i aria-hidden="true">⌃</i>'
  button.addEventListener('click', () => {
    const expanded = panel.classList.toggle('is-expanded')
    button?.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  })
  panel.insertBefore(button, panel.firstChild)
  return button
}

function refreshSystemSummary() {
  const panel = document.querySelector<HTMLElement>('.aman-system-panel')
  if (!panel) return
  panel.classList.add('is-runtime-collapsible')
  const button = ensureSystemSummary(panel)
  const health = button.querySelector<HTMLElement>('.health')
  if (!health) return

  const dataMode = statusValue(panel, 'Data mode')
  const eta = statusValue(panel, 'Live route ETA')
  const sep = statusValue(panel, 'SEP invariant')
  const ghost = statusValue(panel, 'Ghost reserve')
  const reconnect = statusValue(panel, 'Reconnect')

  health.innerHTML = [
    `<b class="${dataMode === 'LIVE' ? 'ok' : ''}">${dataMode}</b>`,
    `<span>ETA ${eta}</span>`,
    `<span class="${sep === 'OK' ? 'ok' : 'warn'}">SEP ${sep}</span>`,
    `<span class="${ghost !== '0' && ghost !== '--' ? 'warn' : ''}">GHOST ${ghost}</span>`,
    reconnect && reconnect !== 'NONE' && reconnect !== '--' ? `<span class="warn">${reconnect}</span>` : '',
  ].filter(Boolean).join('<em>·</em>')
}

export function installSystemPanelRuntime() {
  refreshSystemSummary()
  const timer = window.setInterval(refreshSystemSummary, 1_000)
  return () => {
    window.clearInterval(timer)
    document.querySelector('.aman-system-summary')?.remove()
    document.querySelector('.aman-system-panel')?.classList.remove('is-runtime-collapsible', 'is-expanded')
  }
}
