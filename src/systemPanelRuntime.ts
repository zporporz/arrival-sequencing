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
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = 'SYSTEM'
  const health = document.createElement('span')
  health.className = 'health'
  const caret = document.createElement('i')
  caret.setAttribute('aria-hidden', 'true')
  caret.textContent = '⌃'
  button.append(title, health, caret)
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
  const shared = statusValue(panel, 'Shared AMAN')
  const holding = statusValue(panel, 'Holding / TTLHF')
  const speed = statusValue(panel, 'Speed advisory')
  const ghost = statusValue(panel, 'Ghost reserve')
  const reconnect = statusValue(panel, 'Reconnect')

  const sharedOk = shared === 'LIVE'
  const holdingActive = holding !== 'NONE' && holding !== '0' && holding !== '--'
  const speedActive = speed !== 'NONE' && speed !== '0' && speed !== '--'

  const item = (tag: 'b' | 'span', text: string, className = '') => {
    const node = document.createElement(tag)
    node.textContent = text
    if (className) node.className = className
    return node
  }
  const items = [
    item('b', dataMode, dataMode === 'LIVE' ? 'ok' : ''),
    item('span', `SYNC ${shared}`, sharedOk ? 'ok' : 'warn'),
    item('span', `ETA ${eta}`),
    item('span', `SEP ${sep}`, sep === 'OK' ? 'ok' : 'warn'),
    holdingActive ? item('span', `HLD ${holding}`, 'warn') : null,
    speedActive ? item('span', `SPD ${speed}`) : null,
    item('span', `GHOST ${ghost}`, ghost !== '0' && ghost !== '--' ? 'warn' : ''),
    reconnect && reconnect !== 'NONE' && reconnect !== '--' ? item('span', reconnect, 'warn') : null,
  ].filter((node): node is HTMLElement => node != null)

  const content: Node[] = []
  items.forEach((node, index) => {
    if (index > 0) {
      const separator = document.createElement('em')
      separator.textContent = '·'
      content.push(separator)
    }
    content.push(node)
  })
  health.replaceChildren(...content)
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
