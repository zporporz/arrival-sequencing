type PublishedAirport = {
  id: string
  icao: string
  name: string
}

type PublishedRunway = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
}

type WorkspacePayload = {
  airports: PublishedAirport[]
  runwayConfigs: PublishedRunway[]
}

type FlowConfig = {
  flow: string
  airport: string
  airportName: string
  runway: string
  timingReady: boolean
}

const FALLBACK: FlowConfig = {
  flow: '21',
  airport: 'VTBD',
  airportName: 'Don Mueang',
  runway: '21L / 21R',
  timingReady: true,
}

let publishedFlows: FlowConfig[] = [FALLBACK]

export function getSelectedFlow(): FlowConfig {
  const params = new URLSearchParams(window.location.search)
  const requestedAirport = params.get('airport')?.toUpperCase()
  const requestedFlow = params.get('flow')
  return publishedFlows.find((item) => item.airport === requestedAirport && item.flow === requestedFlow)
    ?? publishedFlows.find((item) => item.flow === requestedFlow)
    ?? publishedFlows[0]
    ?? FALLBACK
}

function switchWorkspace(item: FlowConfig) {
  const url = new URL(window.location.href)
  url.searchParams.set('airport', item.airport)
  url.searchParams.set('flow', item.flow)
  url.searchParams.set('runway', item.runway)
  window.location.assign(url.toString())
}

function makeRunwayButton(item: FlowConfig, selected: FlowConfig) {
  const button = document.createElement('button')
  button.type = 'button'
  const isSelected = item.airport === selected.airport && item.flow === selected.flow
  button.className = [
    'runway-workspace-button',
    isSelected ? 'is-active' : '',
    item.timingReady ? 'is-ready' : 'is-pending',
  ].filter(Boolean).join(' ')
  button.dataset.flow = item.flow
  button.dataset.airport = item.airport
  button.setAttribute('aria-label', `${item.airport} runway ${item.runway}${item.timingReady ? '' : ', timing pending'}`)
  if (isSelected) button.setAttribute('aria-current', 'page')

  const runway = document.createElement('span')
  runway.className = 'runway-workspace-runway'
  runway.textContent = item.runway
  button.appendChild(runway)

  const state = document.createElement('small')
  state.className = 'runway-workspace-state'
  state.textContent = item.timingReady ? 'TIMING ACTIVE' : 'TIMING PENDING'
  button.appendChild(state)

  if (!isSelected) button.addEventListener('click', () => switchWorkspace(item))
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
  const airportCodes = [...new Set(publishedFlows.map((item) => item.airport))]
  for (const airportCode of airportCodes) {
    const first = publishedFlows.find((item) => item.airport === airportCode)
    if (!first) continue
    const button = document.createElement('button')
    button.type = 'button'
    const isSelected = selected.airport === airportCode
    button.className = `airport-workspace-button${isSelected ? ' is-active' : ''}`
    if (isSelected) button.setAttribute('aria-current', 'page')
    button.innerHTML = `<span class="airport-workspace-code">${first.airport}</span><span class="airport-workspace-name">${first.airportName}</span>`
    if (!isSelected) button.addEventListener('click', () => switchWorkspace(first))
    airportTabs.appendChild(button)
  }
  airportRow.appendChild(airportTabs)
  section.appendChild(airportRow)

  const runwayRow = document.createElement('div')
  runwayRow.className = 'destination-nav-row runway-nav-row'

  const runwayHeading = document.createElement('div')
  runwayHeading.className = 'destination-nav-heading'
  runwayHeading.innerHTML = `<span>RUNWAY CONFIGURATION</span><strong>${selected.airport} arrivals</strong>`
  runwayRow.appendChild(runwayHeading)

  const runwayTabs = document.createElement('div')
  runwayTabs.className = 'runway-workspace-tabs'
  for (const item of publishedFlows.filter((flow) => flow.airport === selected.airport)) runwayTabs.appendChild(makeRunwayButton(item, selected))
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
  content.querySelector('.sequence-destination-nav')?.remove()

  const navigation = buildWorkspaceNavigation(selected)
  content.insertBefore(navigation, workspace)
  document.title = 'Bangkok FIR Arrival Sequencing'

  const existingBanner = content.querySelector<HTMLElement>('.timing-pending-banner')
  if (selected.timingReady) {
    existingBanner?.remove()
  } else if (!existingBanner) {
    const banner = document.createElement('div')
    banner.className = 'timing-pending-banner'
    banner.innerHTML = `<strong>${selected.airport} ${selected.runway} timing data pending</strong><span>No source-backed nominal REF FIX-to-landing timing dataset is configured for this runway configuration yet.</span>`
    content.insertBefore(banner, workspace)
  }

  const addButton = document.querySelector<HTMLButtonElement>('.react-workspace-actions .primary-button')
  if (addButton) {
    addButton.disabled = !selected.timingReady
    addButton.title = selected.timingReady ? '' : `${selected.airport} ${selected.runway} timing dataset is not active.`
  }

  return true
}

async function loadPublishedFlows() {
  try {
    const response = await fetch('/api/workspaces', { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return
    const payload = await response.json() as WorkspacePayload
    const airportById = new Map(payload.airports.map((airport) => [airport.id, airport]))
    publishedFlows = payload.runwayConfigs.flatMap((runway) => {
      const airport = airportById.get(runway.airport_id)
      if (!airport) return []
      return [{
        flow: runway.flow,
        airport: airport.icao,
        airportName: airport.name.replace(/ International Airport$| Airport$/i, ''),
        runway: runway.label,
        timingReady: runway.timing_status === 'ACTIVE',
      }]
    })

    const params = new URLSearchParams(window.location.search)
    const requestedAirport = params.get('airport')?.toUpperCase()
    const requestedFlow = params.get('flow')
    const requestedValid = publishedFlows.some((item) => item.airport === requestedAirport && item.flow === requestedFlow)
    if (publishedFlows.length && (requestedAirport || requestedFlow) && !requestedValid) {
      switchWorkspace(publishedFlows[0])
    }
  } catch {
    // Keep the last known/fallback configuration if the public config endpoint is unavailable.
  }
}

export function installFlowSelector() {
  const start = async () => {
    await loadPublishedFlows()
    if (installSelectorUi()) return
    const observer = new MutationObserver(() => {
      if (installSelectorUi()) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start(), { once: true })
  else void start()
}
