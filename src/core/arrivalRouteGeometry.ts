import { readRouteGeometry, type IvaoArrivalTrafficFlight } from './api'
import type { RouteGeometry } from './arrivalEta'
import type { ArrivalStarSelection } from '../../shared/arrivalStarSelection'

export type ArrivalRouteResult = { geometry: RouteGeometry | null; reason: string | null; inferred: boolean; selection?: ArrivalStarSelection | null }
const cache = new Map<string, { airport: string; expiresAt: number; request: Promise<ArrivalRouteResult> }>()

export function clearArrivalRouteCache(airport?: string) {
  for (const [key, value] of cache) if (!airport || value.airport === airport) cache.delete(key)
}

export function resolveArrivalRoute(
  flight: Pick<IvaoArrivalTrafficFlight, 'departure' | 'route'>,
  airport: string,
  entryFix: string,
  arrivalRunway?: string,
  selectedStar?: string,
): Promise<ArrivalRouteResult> {
  if (!flight.departure || !flight.route) return Promise.resolve({ geometry: null, inferred: false, reason: 'Filed route unavailable' })
  const key = JSON.stringify([flight.departure, airport, flight.route, entryFix, arrivalRunway || null, selectedStar || null])
  const old = cache.get(key)
  if (old && old.expiresAt > Date.now()) return old.request
  const request = readRouteGeometry<RouteGeometry>(flight.departure, airport, flight.route, undefined, { entryFix, arrivalRunway, ...(selectedStar ? { selectedStar } : {}) })
    .then((response): ArrivalRouteResult => {
      const selection = response.arrivalSelection
      const partial = response.entryRoute
      const usable = partial && partial.entryFix === entryFix && partial.cycle === response.cycle
        ? partial : response
      if (usable.errors.length || !usable.segments.some(s => s.to.identifier === entryFix)) {
        return { geometry: null, inferred: false, selection,
          reason: [selection?.reason, response.entryRouteError || response.errors.map(e => e.message).join('; ') || `No verified route to ${entryFix}`].filter(Boolean).join(' · ') }
      }
      const transition = response.entryTransition
      const inferred = response.entryRouteSource === 'AIP_INFERRED' || response.entryRouteSource === 'FILED_STAR_TRANSITION'
      const entryReason = inferred && transition
        ? `ENTRY INFERRED ${[transition.via, ...transition.path].join(' → ')} · ${transition.source} · NOT A CLEARED STAR`
        : partial ? 'Verified enroute section only; procedure geometry unavailable' : null
      return { geometry: usable, inferred, selection, reason: [selection?.reason, entryReason].filter(Boolean).join(' · ') || null }
    })
    .catch((error): ArrivalRouteResult => ({ geometry: null, inferred: false,
      reason: error instanceof Error ? error.message : 'Route lookup failed' }))
  // Bound memory and periodically revalidate AIRAC; never cache a failed lookup
  // for a whole flight. Short failure caching avoids a request storm per refresh.
  if (cache.size >= 500) cache.delete(cache.keys().next().value!)
  cache.set(key, { airport, expiresAt: Date.now() + 60_000, request })
  return request
}
