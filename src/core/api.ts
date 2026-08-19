export type WorkspaceAirport = {
  id: string
  icao: string
  name: string
}

export type WorkspaceRunway = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
}

export type WorkspaceStar = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  effective_from: string | null
  effective_to: string | null
  active: boolean
}

export type WorkspacePayload = {
  airports: WorkspaceAirport[]
  runwayConfigs: WorkspaceRunway[]
  starProcedures: WorkspaceStar[]
}

export type IvaoArrivalTrafficFlight = {
  sessionId: string
  vid: string | null
  callsign: string
  aircraft: string | null
  wakeTurbulence: string | null
  departure: string | null
  arrival: string
  route: string | null
  flightRules: string | null
  state: string | null
  onGround: boolean | null
  trackTimestamp: string | null
  altitude: number | null
  verticalSpeedFpm: number | null
  groundSpeed: number | null
  latitude: number | null
  longitude: number | null
  heading: number | null
  connectedAt: string | null
  airlineIcao: string | null
  flightPlanId: string | null
  flightPlanRevision: number | null
  filedCruiseAltitudeFt: number | null
  filedDepartureTimeSeconds: number | null
  actualDepartureTimeSeconds: number | null
  filedEetSeconds: number | null
  departureCountryId: string | null
  arrivalCountryId: string | null
  isDomesticThailand: boolean
  trackedTakeoffAt: string | null
  filedDestinationEtaAt: string | null
  domesticTriggerStatus: 'READY' | 'WAITING_TAKEOFF' | 'EET_UNAVAILABLE' | 'TAKEOFF_UNAVAILABLE' | 'NOT_DOMESTIC' | 'UNKNOWN'
  domesticTriggerError: string | null
  flightPlanDetailError: string | null
}

export type AircraftPerformanceProfile = {
  source: 'SIMBRIEF'
  aircraftType: string
  aircraftName: string | null
  aircraftDefaultCruise: string | null
  aircraftSpeed: string | null
  descentProfile: string
  descentMach: number
  descentIasKt: number
  descentBelow10000IasKt: number
}

export type AircraftPerformancePayload = {
  type: string
  found: boolean
  profile?: AircraftPerformanceProfile
  fallback?: {
    descentMach: number | null
    descentIasKt: number
    descentBelow10000IasKt: number
  }
}

export type IvaoTrafficPayload<TFlight = IvaoArrivalTrafficFlight> = {
  airport: string
  fetchedAt: string
  flights?: TFlight[]
  inbound?: TFlight[]
  departures?: TFlight[]
  error?: string
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload && payload.error
      ? String(payload.error)
      : `API returned ${response.status}`
    throw new Error(message)
  }
  return payload
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  return readJson<T>(response)
}

export async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return readJson<T>(response)
}

export function readWorkspaces() {
  return apiGet<Partial<WorkspacePayload>>('/api/workspaces').then((payload) => ({
    airports: payload.airports ?? [],
    runwayConfigs: payload.runwayConfigs ?? [],
    starProcedures: payload.starProcedures ?? [],
  }))
}

export function readIvaoTraffic<TFlight = IvaoArrivalTrafficFlight>(airport: string, mode?: 'summary') {
  const params = new URLSearchParams({ airport: airport.trim().toUpperCase() })
  if (mode) params.set('mode', mode)
  return apiGet<IvaoTrafficPayload<TFlight>>(`/api/sequence/ivao-traffic?${params.toString()}`)
}

export function readAircraftPerformance(type: string) {
  const params = new URLSearchParams({ type: type.trim().toUpperCase() })
  return apiGet<AircraftPerformancePayload>(`/api/sequence/aircraft-performance?${params.toString()}`)
}

export function readRouteGeometry<TGeometry>(origin: string, destination: string, route: string) {
  return apiPost<TGeometry>('/api/sequence/route-geometry', {
    origin: origin.trim().toUpperCase(),
    destination: destination.trim().toUpperCase(),
    route: route.trim().toUpperCase(),
  })
}

export function sequenceRequest<T>(path: string, body: Record<string, unknown>) {
  return apiPost<T>(path, body)
}
