type FlowConfig = {
  flow: '21' | '03'
  runway: string
  label: string
  timingReady: boolean
}

const FLOWS: FlowConfig[] = [
  { flow: '21', runway: '21L / 21R', label: 'VTBD · RWY 21', timingReady: true },
  { flow: '03', runway: '03L / 03R', label: 'VTBD · RWY 03', timingReady: true },
]

export function getSelectedFlow(): FlowConfig {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('flow')
  return FLOWS.find((item) => item.flow === requested) ?? FLOWS[0]
}

function switchFlow(flow: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('flow', flow)
  window.location.assign(url.toString())
}

function installSelectorUi() {
  const selected = getSelectedFlow()
  const toolbar = document.querySelector<HTMLElement>('.toolbar-controls')
  if (!toolbar || toolbar.querySelector('.flow-selector-wrap')) return false

  const oldButton = toolbar.querySelector<HTMLButtonElement>('.secondary-button')
  oldButton?.remove()

  const wrap = document.createElement('div')
  wrap.className = 'flow-selector-wrap'
  wrap.innerHTML = `
    <span class="flow-selector-label">AIRPORT / FLOW</span>
    <select class="flow-selector" aria-label="Airport and runway flow">
      ${FLOWS.map((item) => `<option value="${item.flow}" ${item.flow === selected.flow ? 'selected' : ''}>${item.label}${item.timingReady ? '' : ' · PENDING'}</option>`).join('')}
    </select>
  `

  const select = wrap.querySelector<HTMLSelectElement>('.flow-selector')!
  select.addEventListener('change', () => switchFlow(select.value))
  toolbar.appendChild(wrap)

  const subtitle = document.querySelector<HTMLElement>('.brand-block p')
  if (subtitle) subtitle.textContent = `Flow ${selected.flow} · ${selected.runway} · Shared realtime workspace`

  if (!selected.timingReady) {
    const content = document.querySelector<HTMLElement>('.content')
    if (content && !content.querySelector('.timing-pending-banner')) {
      const banner = document.createElement('div')
      banner.className = 'timing-pending-banner'
      banner.innerHTML = '<strong>Timing data pending</strong><span>This flow has its own realtime session, but Add Flight is disabled until its REF FIX timing dataset is entered and reviewed.</span>'
      content.prepend(banner)
    }

    const addButton = document.querySelector<HTMLButtonElement>('.primary-button')
    if (addButton) {
      addButton.disabled = true
      addButton.title = 'Timing dataset is not configured yet.'
    }
  }

  return true
}

export function installFlowSelector() {
  const start = () => {
    if (installSelectorUi()) return
    const observer = new MutationObserver(() => {
      if (installSelectorUi()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
