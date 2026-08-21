type SharedFlightState = {
  airport?: string
  callsign?: string
  revision?: number
}

type SharedWorkspaceState = {
  airport?: string
  revision?: number
}

type SharedStateDetail = {
  flightStates?: SharedFlightState[]
  workspaceStates?: SharedWorkspaceState[]
}

const SHARED_STATE_EVENT = 'aman:shared-state'
const AMAN_STATE_PATH = '/api/sequence/aman-state'
const TEST_FLIGHT_ACTIONS = new Set([
  'setManualTarget',
  'clearManualTarget',
  'setHolding',
  'setOperationalState',
  'setOperationalGap',
])

function testTrafficEnabled() {
  return document.querySelector('.aman-demo-toggle.is-active') != null
}

function demoFlightRows() {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row.is-demo'))
}

function demoIdentity(row: HTMLElement) {
  const title = row.getAttribute('title') || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : ''
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  return airport && callsign ? `${airport}:${callsign}` : ''
}

function demoIdentitySet() {
  return new Set(demoFlightRows().map(demoIdentity).filter(Boolean))
}

function configAirport(block: HTMLElement) {
  const label = block.querySelector<HTMLElement>('.aman-profile-select > span')?.textContent?.trim().toUpperCase() || ''
  return label.match(/^(VTBD|VTBS)\s+CONFIG$/)?.[1] || ''
}

function protectDemoStateFromSharedApply(detail: SharedStateDetail | undefined) {
  if (!testTrafficEnabled()) return

  const flightByIdentity = new Map<string, SharedFlightState>()
  for (const state of detail?.flightStates || []) {
    const airport = String(state.airport || '').trim().toUpperCase()
    const callsign = String(state.callsign || '').trim().toUpperCase()
    if (airport && callsign) flightByIdentity.set(`${airport}:${callsign}`, state)
  }

  for (const row of demoFlightRows()) {
    const state = flightByIdentity.get(demoIdentity(row))
    const revision = Number(state?.revision)
    if (!Number.isFinite(revision)) continue
    const value = String(revision)
    // Both shared target runtimes use these revisions as their already-applied gate.
    row.dataset.sharedRevision = value
    row.dataset.manualSyncCompatRevision = value
  }

  const workspaceByAirport = new Map<string, SharedWorkspaceState>()
  for (const state of detail?.workspaceStates || []) {
    const airport = String(state.airport || '').trim().toUpperCase()
    if (airport) workspaceByAirport.set(airport, state)
  }

  document.querySelectorAll<HTMLElement>('.aman-runway-config-block').forEach((block) => {
    const state = workspaceByAirport.get(configAirport(block))
    const revision = Number(state?.revision)
    if (Number.isFinite(revision)) block.dataset.sharedRevision = String(revision)
  })
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url, window.location.href)
  return new URL(String(input), window.location.href)
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return ''
    }
  }
  return ''
}

function fakeSuccess(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  })
}

export function installTestTrafficIsolationRuntime() {
  const originalFetch = window.fetch.bind(window)

  const isolatedFetch: typeof window.fetch = async (input, init) => {
    if (!testTrafficEnabled()) return originalFetch(input, init)

    const url = requestUrl(input)
    if (url.origin !== window.location.origin || url.pathname !== AMAN_STATE_PATH || requestMethod(input, init) !== 'POST') {
      return originalFetch(input, init)
    }

    const text = await requestBody(input, init)
    try {
      const payload = JSON.parse(text) as { action?: string; airport?: string; callsign?: string }
      const action = String(payload.action || '')
      const airport = String(payload.airport || '').trim().toUpperCase()
      const callsign = String(payload.callsign || '').trim().toUpperCase()

      if (action === 'syncWorkspace') {
        // Runway modes and spacing may be changed locally for a test scenario, but
        // TEST TRAFFIC must not overwrite the production shared workspace.
        return fakeSuccess({ workspaceState: null })
      }

      if (TEST_FLIGHT_ACTIONS.has(action) && demoIdentitySet().has(`${airport}:${callsign}`)) {
        // TEST TRAFFIC runs the same local sequencing/lifecycle handlers, but its
        // synthetic callsigns must never create or overwrite production flight rows.
        return fakeSuccess({ flightState: null })
      }
    } catch {
      // Invalid/non-JSON requests continue to the original fetch implementation.
    }

    return originalFetch(input, init)
  }

  window.fetch = isolatedFetch

  const onSharedState = (event: Event) => {
    protectDemoStateFromSharedApply((event as CustomEvent<SharedStateDetail>).detail)
  }
  window.addEventListener(SHARED_STATE_EVENT, onSharedState)

  return () => {
    window.removeEventListener(SHARED_STATE_EVENT, onSharedState)
    if (window.fetch === isolatedFetch) window.fetch = originalFetch
  }
}
