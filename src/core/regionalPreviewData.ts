import { apiGet, readAircraftPerformance, readIvaoTraffic, readRouteGeometry, type AircraftPerformanceProfile, type IvaoTrafficPayload } from './api'
import type { RouteGeometry } from './arrivalEtaLegacy'
import { resolveRegionalStar, type RegionalNavPayload } from './regionalArrivalModel'

type Cache<T> = Map<string, { expires: number; value: T }>
const profiles: Cache<AircraftPerformanceProfile | null> = new Map()
const routes: Cache<RouteGeometry | null> = new Map()
const inflight = new Map<string, Promise<unknown>>()
async function timed<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try { return await action(controller.signal) } finally { clearTimeout(timer) }
}
async function cached<T>(cache: Cache<T>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const old = cache.get(key)
  if (old && old.expires > Date.now()) return old.value
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const promise = fetcher().then((value) => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!)
    cache.set(key, { value, expires: Date.now() + (value == null ? 60_000 : 300_000) })
    return value
  }).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
export function previewPerformance(type: string) {
  const code = type.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,4}$/.test(code)) return Promise.resolve(null)
  return cached(profiles, `profile:${code}`, async () => {
    const result = await timed((signal) => readAircraftPerformance(code, signal))
    return result.found && result.profile ? result.profile : null
  })
}
export type RegionalSnapshot = {
  traffic: IvaoTrafficPayload
  profiles: Record<string, AircraftPerformanceProfile | null>
  routes: Record<string, RouteGeometry | null>
  routeErrors?: Record<string, string>
}
export const readRegionalNav = (airport: string) => timed((signal) => apiGet<RegionalNavPayload>(`/api/sequence/regional-navdata?airport=${encodeURIComponent(airport)}`, signal))
export async function readRegionalSnapshot(nav: RegionalNavPayload, runway: string, operational = false, sharedTraffic?: IvaoTrafficPayload): Promise<RegionalSnapshot> {
  // Re-check active cycle on every refresh; an open tab must stop using stale data.
  const current = await readRegionalNav(nav.airport.code)
  if (current.cycle !== nav.cycle) throw new Error('Active AIRAC changed — refresh regional navdata')
  if (sharedTraffic && (!operational || sharedTraffic.airport !== nav.airport.code)) throw new Error('Traffic snapshot scope mismatch')
  const traffic = sharedTraffic ?? await timed((signal) => readIvaoTraffic(nav.airport.code, operational ? undefined : 'regional-preview', signal))
  const output: RegionalSnapshot = { traffic, profiles: {}, routes: {}, routeErrors: {} }
  const flights = traffic.flights || []
  let next = 0
  // A small pool also bounds route parsing requests on busy airports.
  await Promise.all(Array.from({ length: Math.min(4, flights.length) }, async () => {
    while (next < flights.length) {
      const flight = flights[next++]
      const type = flight.aircraft || ''
      output.profiles[type] = await previewPerformance(type).catch(() => null)
      const star = resolveRegionalStar(nav.airport, runway, flight.route)
      if (!flight.route || !flight.departure || flight.onGround === true || !star) continue
      const entryFix = star.legs[0]?.fix || undefined
      const key = `route:${nav.cycle}:${runway}:${entryFix}:${flight.departure}:${flight.arrival}:${flight.route}`
      try {
        output.routes[flight.sessionId] = await cached(routes, key,
          () => timed((signal) => readRouteGeometry<RouteGeometry>(flight.departure!, flight.arrival, flight.route!, signal,
            { arrivalRunway: runway, cycle: nav.cycle, entryFix })))
      } catch (error) {
        output.routes[flight.sessionId] = null
        output.routeErrors![flight.sessionId] = error instanceof Error ? error.message : 'Route service unavailable'
      }
    }
  }))
  return output
}
