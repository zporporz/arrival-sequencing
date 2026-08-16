type FlowConfig = {
  flow: '21' | '03'
  airport: 'VTBD'
  airportName: string
  runway: string
  timingReady: boolean
}

const FLOWS: FlowConfig[] = [
  { flow: '21', airport: 'VTBD', airportName: 'Don Mueang', runway: '21L / 21R', timingReady: true },
  { flow: '03', airport: 'VTBD', airportName: 'Don Mueang', runway: '03L / 03R', timingReady: false },
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

function makeRunwayButton(item: FlowConfig, selected: FlowConfig) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = [
    'runway-workspace-button',
    item.flow === selected.flow ? 'is-active' : '',
    item.timingReady ? 'is-ready' : 'is-pending',
  ].filter(Boolean).join(' ')
  button.dataset.flow = item.flow
  button.setAttribute('aria-label', `${item.airport} runway ${item.runway}${item.timingReady ? '' : ', timing pending'}`)
  if (item.flow === selected.flow) button.setAttribute('aria-current', 'page')

  const runway = document.createElement('span')
  runway.className = 'runway-workspace-runway'
  runway.textContent = item.runway
  button.appendChild(runway)

  const state = document.createElement('small')
  state.className = 'runway-workspace-state'
  state.textContent = item.timingReady ? 'TIMING ACTIVE' : 'TIMING PENDING'
  button.appendChild(state)

  if (item.flow !== selected.flow) button.addEventListener('click', () => switchFlow(item.flow))
  return button
}

function buildWorkspaceNavigation(selected: FlowConfig) {
  const section = document.createElement('section')
  section.className = 'sequence-destination-nav'
  section.setAttribute('aria-label', 'Arrival sequencing workspace navigation')

  const airportRow = document.createElement('div')
  airportRow.className = 'destination-nav-row airport-nav-row'

  const airportHeading = document.createElement('div')
  airportHeading.className = 'destination-nav-heading'
  airportHeading.innerHTML = '<span>AIRPORT</span><strong>Select workspace</strong>'
  airportRow.appendChild(airportHeading)

  const airportTabs = document.createElement('div')
  airportTabs.className = 'airport-workspace-tabs'
  airportTabs.innerHTML = `
    <button type="button" class="airport-workspace-button is-active" aria-current="page">
      <span class="airport-workspace-code">VTBD</span>
      <span class="airport-workspace-name">Don Mueang</span>
    </button>
    <button type="button" class="airport-workspace-button is-disabled" disabled title="VTBS timing dataset is not configured yet">
      <span class="airport-workspace-code">VTBS</span>
      <span class="airport-workspace-name">Suvarnabhumi</span>
      <small>COMING SOON</small>
    </button>
  `
  airportRow.appendChild(airportTabs)
  section.appendChild(airportRow)

  const runwayRow = document.createElement('div')
  runwayRow.className = 'destination-nav-row runway-nav-row'

  const runwayHeading = document.createElement('div')
  runwayHeading.className = 'destination-nav-heading'
  runwayHeading.innerHTML = '<span>RUNWAY CONFIGURATION</span><strong>VTBD arrivals</strong>'
  runwayRow.appendChild(runwayHeading)

  const runwayTabs = document.createElement('div')
  runwayTabs.className = 'runway-workspace-tabs'
  for (const item of FLOWS) runwayTabs.appendChild(makeRunwayButton(item, selected))
  runwayRow.appendChild(runwayTabs)
  section.appendChild(runwayRow)

  return section
}

function installSelectorUi() {
  const selected = getSelectedFlow()
  const content = document.querySelector<HTMLElement>('.content')
  const workspace = content?.querySelector<HTMLElement>('.workspace-card')
  const toolbar = document.querySelector<HTMLElement>('.toolbar-controls')
  if (!content || !workspace || !toolbar) return false

  toolbar.querySelector('.flow-selector-wrap')?.remove()
  toolbar.querySelector('.secondary-button')?.remove()

  let navigation = content.querySelector<HTMLElement>('.sequence-destination-nav')
  if (!navigation) {
    navigation = buildWorkspaceNavigation(selected)
    content.insertBefore(navigation, workspace)
  }

  document.title = 'Bangkok FIR Arrival Sequencing'

  const existingBanner = content.querySelector<HTMLElement>('.timing-pending-banner')
  if (selected.timingReady) {
    existingBanner?.remove()
  } else if (!existingBanner) {
    const banner = document.createElement('div')
    banner.className = 'timing-pending-banner'
    banner.innerHTML = '<strong>VTBD RWY 03 timing data pending</strong><span>No source-backed nominal REF FIX-to-landing timing dataset is configured for this runway configuration yet.</span>'
    content.insertBefore(banner, workspace)
  }

  if (!selected.timingReady) {
    const addButton = document.querySelector<HTMLButtonElement>('.react-workspace-actions .primary-button')
    if (addButton) {
      addButton.disabled = true
      addButton.title = 'VTBD RWY 03 timing dataset is not configured yet.'
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
