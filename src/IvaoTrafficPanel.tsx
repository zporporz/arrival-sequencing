import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ivaoTraffic.css'

type TrafficFlight = {
  sessionId: string
  vid: string | null
  callsign: string
  aircraft: string | null
  departure: string | null
  arrival: string
  route: string | null
  state: string | null
  altitude: number | null
  groundSpeed: number | null
  latitude: number | null
  longitude: number | null
  heading: number | null
  connectedAt: string | null
  airlineIcao: string | null
}

type Props = {
  airport: string
  fixes: string[]
  existingCallsigns: string[]
  disabled?: boolean
  onAdd: (flight: TrafficFlight, refFix: string, eto: string) => Promise<void>
}

type TrafficPayload = {
  airport?: string
  fetchedAt?: string
  flights?: TrafficFlight[]
  error?: string
}

type Coordinates = { lat: number; lon: number }
type RoutePoint = { identifier: string; type: string | null; coordinates: Coordinates }
type RouteSegment = {
  from: RoutePoint
  to: RoutePoint
  distance: number
  bearing: number | null
  cumulativeDistance: number
}
type RouteGeometry = {
  origin: string
  destination: string
  totalDistance: number | null
  segments: RouteSegment[]
  errors: Array<{ type: string; message: string }>
}
type RouteGeometryPayload = RouteGeometry & { error?: string }

type Draft = {
  refFix: string
  eto: string
  refFixManual: boolean
  etoManual: boolean
}

type AutoEstimate = {
  status: 'ready' | 'waiting' | 'unavailable' | 'calculating'
  refFix: string | null
  eto: string
  remainingNm: number | null
  minutes: number | null
  groundSpeed: number | null
  offRouteNm: number | null
  reason: string | null
}

type RouteProgress = { progressNm: number; offRouteNm: number }

const AUTO_REFRESH_MS = 30_000
const IDLE_TIMEOUT_MS = 10 * 60_000
const IDLE_CHECK_MS = 15_000
const AUTO_ETO_LOOKAHEAD_MIN = 60
const MIN_AUTO_GS_KT = 80
const MAX_ROUTE_DEVIATION_NM = 100

const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
const routeKey = (flight: TrafficFlight, airport: string) => `${flight.departure || ''}|${airport}|${flight.route || ''}`

function formatUtcHhmm(timestampMs: number) {
  const date = new Date(timestampMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function suggestedFix(route: string | null, fixes: string[]) {
  if (!fixes.length) return ''
  if (!route) return fixes[0]
  const normalized = ` ${route.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `
  let best = fixes[0]
  let bestIndex = -1
  for (const fix of fixes) {
    const index = normalized.lastIndexOf(` ${fix.toUpperCase()} `)
    if (index > bestIndex) {
      bestIndex = index
      best = fix
    }
  }
  return best
}

function formatTrack(flight: TrafficFlight) {
  const parts: string[] = []
  if (flight.altitude != null) parts.push(`ALT ${Math.round(flight.altitude)} ft`)
  if (flight.groundSpeed != null) parts.push(`${Math.round(flight.groundSpeed)} kt`)
  if (flight.state) parts.push(flight.state)
  return parts.join(' · ') || 'Online'
}

function segmentProjection(current: Coordinates, segment: RouteSegment) {
  const meanLat = ((current.lat + segment.from.coordinates.lat + segment.to.coordinates.lat) / 3) * Math.PI / 180
  const lonScale = 60 * Math.cos(meanLat)
  const ax = (segment.from.coordinates.lon - current.lon) * lonScale
  const ay = (segment.from.coordinates.lat - current.lat) * 60
  const bx = (segment.to.coordinates.lon - current.lon) * lonScale
  const by = (segment.to.coordinates.lat - current.lat) * 60
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const rawT = lengthSquared > 0 ? -(ax * dx + ay * dy) / lengthSquared : 0
  const t = Math.max(0, Math.min(1, rawT))
  const px = ax + t * dx
  const py = ay + t * dy
  return { t, distanceNm: Math.hypot(px, py) }
}

function findRouteProgress(flight: TrafficFlight, geometry: RouteGeometry): RouteProgress | null {
  if (flight.latitude == null || flight.longitude == null) return null
  const current = { lat: flight.latitude, lon: flight.longitude }
  let best: RouteProgress | null = null

  for (const segment of geometry.segments) {
    if (!Number.isFinite(segment.distance) || !Number.isFinite(segment.cumulativeDistance)) continue
    const projected = segmentProjection(current, segment)
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    const progressNm = startDistance + projected.t * segment.distance
    if (!best || projected.distanceNm < best.offRouteNm) {
      best = { progressNm, offRouteNm: projected.distanceNm }
    }
  }
  return best
}

function fixDistanceAlongRoute(geometry: RouteGeometry, fix: string, currentProgressNm: number) {
  const target = fix.trim().toUpperCase()
  const candidates: number[] = []
  for (const segment of geometry.segments) {
    const startDistance = Math.max(0, segment.cumulativeDistance - segment.distance)
    if (segment.from.identifier.toUpperCase() === target && startDistance >= currentProgressNm - 1) candidates.push(startDistance)
    if (segment.to.identifier.toUpperCase() === target && segment.cumulativeDistance >= currentProgressNm - 1) candidates.push(segment.cumulativeDistance)
  }
  return candidates.sort((a, b) => a - b)[0] ?? null
}

function upcomingConfiguredFix(flight: TrafficFlight, geometry: RouteGeometry, fixes: string[]) {
  const progress = findRouteProgress(flight, geometry)
  if (!progress) return suggestedFix(flight.route, fixes)
  const candidates = fixes
    .map((fix) => ({ fix, distance: fixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => a.distance - b.distance)
  return candidates[0]?.fix || suggestedFix(flight.route, fixes)
}

function autoEstimate(
  flight: TrafficFlight,
  geometry: RouteGeometry | null,
  refFix: string,
  groundSpeed: number | null,
  baseTimeIso: string,
): AutoEstimate {
  if (!refFix) return { status: 'unavailable', refFix: null, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'No REF FIX' }
  if (!flight.route || !flight.departure) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Filed route unavailable' }
  if (flight.latitude == null || flight.longitude == null) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Live position unavailable' }
  if (!geometry) return { status: 'calculating', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Resolving filed route' }
  if (groundSpeed == null || groundSpeed < MIN_AUTO_GS_KT) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Ground speed too low' }

  const progress = findRouteProgress(flight, geometry)
  if (!progress) return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: null, reason: 'Unable to locate aircraft on route' }
  if (progress.offRouteNm > MAX_ROUTE_DEVIATION_NM) {
    return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: progress.offRouteNm, reason: 'Aircraft too far from filed route' }
  }

  const targetDistance = fixDistanceAlongRoute(geometry, refFix, progress.progressNm)
  if (targetDistance == null) {
    return { status: 'unavailable', refFix, eto: '', remainingNm: null, minutes: null, groundSpeed, offRouteNm: progress.offRouteNm, reason: 'REF FIX not ahead in filed route' }
  }

  const remainingNm = Math.max(0, targetDistance - progress.progressNm) + progress.offRouteNm
  const minutes = remainingNm / groundSpeed * 60
  const baseTime = new Date(baseTimeIso).getTime()
  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now()
  const eto = formatUtcHhmm(safeBaseTime + minutes * 60_000)

  if (minutes > AUTO_ETO_LOOKAHEAD_MIN) {
    return { status: 'waiting', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: `Outside ${AUTO_ETO_LOOKAHEAD_MIN} min auto-fill window` }
  }
  return { status: 'ready', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: null }
}

function estimateText(estimate: AutoEstimate | undefined, manual: boolean) {
  if (!estimate) return 'AUTO ETO · waiting for route data'
  if (manual) {
    if (estimate.status === 'ready') return `MANUAL ETO · auto estimate ${estimate.eto}Z available`
    return 'MANUAL ETO · automatic estimate not applied'
  }
  if (estimate.status === 'ready') {
    return `AUTO ETO · ${estimate.refFix} ${estimate.eto}Z · ${Math.round(estimate.remainingNm || 0)} NM · GS ${Math.round(estimate.groundSpeed || 0)}`
  }
  if (estimate.status === 'waiting') {
    return `AUTO ETO waiting · ${Math.ceil(estimate.minutes || 0)} min to ${estimate.refFix} · auto-fill starts ≤${AUTO_ETO_LOOKAHEAD_MIN} min`
  }
  if (estimate.status === 'calculating') return `AUTO ETO · ${estimate.reason || 'calculating'}`
  return `AUTO ETO unavailable · ${estimate.reason || 'insufficient data'}`
}

export default function IvaoTrafficPanel({ airport, fixes, existingCallsigns, disabled, onAdd }: Props) {
  const [flights, setFlights] = useState<TrafficFlight[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [autoEstimates, setAutoEstimates] = useState<Record<string, AutoEstimate>>({})
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const idleRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const draftsRef = useRef<Record<string, Draft>>({})
  const geometryCacheRef = useRef(new Map<string, RouteGeometry | null>())
  const geometryPendingRef = useRef(new Map<string, Promise<RouteGeometry | null>>())
  const gsHistoryRef = useRef(new Map<string, number[]>())

  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])

  const setDraftState = useCallback((next: Record<string, Draft>) => {
    draftsRef.current = next
    setDrafts(next)
  }, [])

  const smoothedGroundSpeed = useCallback((flight: TrafficFlight) => {
    const current = flight.groundSpeed
    if (current != null && current >= MIN_AUTO_GS_KT && current <= 750) {
      const samples = [...(gsHistoryRef.current.get(flight.sessionId) || []), current].slice(-4)
      gsHistoryRef.current.set(flight.sessionId, samples)
    }
    const samples = gsHistoryRef.current.get(flight.sessionId) || []
    if (!samples.length) return current
    return samples.reduce((sum, value) => sum + value, 0) / samples.length
  }, [])

  const getRouteGeometry = useCallback(async (flight: TrafficFlight) => {
    if (!flight.departure || !flight.route) return null
    const key = routeKey(flight, airport)
    if (geometryCacheRef.current.has(key)) return geometryCacheRef.current.get(key) ?? null
    const pending = geometryPendingRef.current.get(key)
    if (pending) return pending

    const request = (async () => {
      try {
        const response = await fetch('/api/sequence/route-geometry', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: flight.departure, destination: airport, route: flight.route }),
        })
        const payload = await response.json() as RouteGeometryPayload
        if (!response.ok) throw new Error(payload.error || `Route geometry returned ${response.status}`)
        geometryCacheRef.current.set(key, payload)
        return payload
      } catch {
        geometryCacheRef.current.set(key, null)
        return null
      } finally {
        geometryPendingRef.current.delete(key)
      }
    })()

    geometryPendingRef.current.set(key, request)
    return request
  }, [airport])

  const refresh = useCallback(async () => {
    if (!airport || refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/sequence/ivao-traffic?airport=${encodeURIComponent(airport)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const payload = await response.json() as TrafficPayload
      if (!response.ok) throw new Error(payload.error || `IVAO traffic returned ${response.status}`)
      const nextFlights = payload.flights || []
      const nextFetchedAt = payload.fetchedAt || new Date().toISOString()
      setFlights(nextFlights)
      setFetchedAt(nextFetchedAt)

      const geometries = new Map<string, RouteGeometry | null>()
      await Promise.all(nextFlights.map(async (flight) => {
        geometries.set(flight.sessionId, await getRouteGeometry(flight))
      }))

      const currentDrafts = draftsRef.current
      const nextDrafts: Record<string, Draft> = {}
      const nextAuto: Record<string, AutoEstimate> = {}
      for (const flight of nextFlights) {
        const geometry = geometries.get(flight.sessionId) ?? null
        const previous = currentDrafts[flight.sessionId]
        const suggested = geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes)
        const refFix = previous?.refFixManual ? previous.refFix : (suggested || previous?.refFix || fixes[0] || '')
        const gs = smoothedGroundSpeed(flight)
        const estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt)
        const etoManual = previous?.etoManual ?? false
        const eto = etoManual ? (previous?.eto || '') : (estimate.status === 'ready' ? estimate.eto : '')
        nextDrafts[flight.sessionId] = {
          refFix,
          eto,
          refFixManual: previous?.refFixManual ?? false,
          etoManual,
        }
        nextAuto[flight.sessionId] = estimate
      }
      setDraftState(nextDrafts)
      setAutoEstimates(nextAuto)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      refreshInFlightRef.current = false
      setLoading(false)
    }
  }, [airport, fixes, getRouteGeometry, setDraftState, smoothedGroundSpeed])

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (!idleRef.current) return
    idleRef.current = false
    setIdle(false)
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel']
    for (const eventName of activityEvents) window.addEventListener(eventName, markActivity, { passive: true })
    return () => {
      for (const eventName of activityEvents) window.removeEventListener(eventName, markActivity)
    }
  }, [markActivity])

  useEffect(() => {
    if (!open) return

    const autoRefreshTimer = window.setInterval(() => {
      if (idleRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        idleRef.current = true
        setIdle(true)
        return
      }
      void refresh()
    }, AUTO_REFRESH_MS)

    const idleCheckTimer = window.setInterval(() => {
      if (idleRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        idleRef.current = true
        setIdle(true)
      }
    }, IDLE_CHECK_MS)

    return () => {
      window.clearInterval(autoRefreshTimer)
      window.clearInterval(idleCheckTimer)
    }
  }, [open, refresh])

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open
    setOpen(nextOpen)
    if (!nextOpen) return
    lastActivityRef.current = Date.now()
    idleRef.current = false
    setIdle(false)
    void refresh()
  }

  const manualRefresh = () => {
    lastActivityRef.current = Date.now()
    idleRef.current = false
    setIdle(false)
    void refresh()
  }

  const changeRefFix = (flight: TrafficFlight, refFix: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix, eto: '', refFixManual: false, etoManual: false }
    const geometry = geometryCacheRef.current.get(routeKey(flight, airport)) ?? null
    const gsSamples = gsHistoryRef.current.get(flight.sessionId) || []
    const gs = gsSamples.length ? gsSamples.reduce((sum, value) => sum + value, 0) / gsSamples.length : flight.groundSpeed
    const estimate = autoEstimate(flight, geometry, refFix, gs, fetchedAt || new Date().toISOString())
    const nextDraft = {
      ...current,
      refFix,
      refFixManual: true,
      eto: current.etoManual ? current.eto : (estimate.status === 'ready' ? estimate.eto : ''),
    }
    const next = { ...draftsRef.current, [flight.sessionId]: nextDraft }
    setDraftState(next)
    setAutoEstimates((all) => ({ ...all, [flight.sessionId]: estimate }))
  }

  const changeEto = (flight: TrafficFlight, eto: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix: fixes[0] || '', eto: '', refFixManual: false, etoManual: false }
    const next = {
      ...draftsRef.current,
      [flight.sessionId]: { ...current, eto: eto.replace(/[^0-9:]/g, '').slice(0, 5), etoManual: true },
    }
    setDraftState(next)
  }

  const useAutoEto = (flight: TrafficFlight) => {
    const estimate = autoEstimates[flight.sessionId]
    if (!estimate || estimate.status !== 'ready') return
    const current = draftsRef.current[flight.sessionId]
    if (!current) return
    setDraftState({
      ...draftsRef.current,
      [flight.sessionId]: { ...current, eto: estimate.eto, etoManual: false },
    })
  }

  const add = async (flight: TrafficFlight) => {
    const draft = drafts[flight.sessionId]
    if (!draft || !draft.refFix || !validTime(draft.eto)) return
    setAdding(flight.sessionId)
    setError(null)
    try {
      await onAdd(flight, draft.refFix, draft.eto)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(null)
    }
  }

  return (
    <details className="ivao-traffic-menu" onToggle={handleToggle}>
      <summary className="ivao-traffic-trigger" title={`IVAO inbound traffic for ${airport}`}>
        IVAO Traffic <b>{flights.length}</b>
      </summary>
      <div className="ivao-traffic-popover">
        <div className="ivao-traffic-heading">
          <div>
            <strong>IVAO inbound · {airport}</strong>
            <span>AUTO ETO uses filed-route distance + live GS inside the final {AUTO_ETO_LOOKAHEAD_MIN} minutes. Manual override remains available.</span>
          </div>
          <button type="button" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error && <div className="ivao-traffic-error">{error}</div>}
        {!error && flights.length === 0 && <div className="ivao-traffic-empty">No connected IVAO arrivals to {airport}.</div>}

        <div className="ivao-traffic-list">
          {flights.map((flight) => {
            const draft = drafts[flight.sessionId] || { refFix: fixes[0] || '', eto: '', refFixManual: false, etoManual: false }
            const estimate = autoEstimates[flight.sessionId]
            const alreadyAdded = existing.has(flight.callsign.toUpperCase())
            const canAdd = !disabled && !alreadyAdded && Boolean(draft.refFix) && validTime(draft.eto)
            return <article className="ivao-traffic-flight" key={flight.sessionId}>
              <div className="ivao-traffic-logo">
                {flight.airlineIcao
                  ? <img src={`/api/sequence/airline-logo?icao=${encodeURIComponent(flight.airlineIcao)}`} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} />
                  : <span>{flight.callsign.slice(0, 2)}</span>}
              </div>
              <div className="ivao-traffic-main">
                <div className="ivao-traffic-call"><strong>{flight.callsign}</strong><span>{flight.aircraft || '—'}</span></div>
                <div className="ivao-traffic-route"><strong>{flight.departure || '----'}</strong><span>→</span><strong>{airport}</strong>{flight.vid && <small>VID {flight.vid}</small>}</div>
                <small className="ivao-traffic-track">{formatTrack(flight)}</small>
                <small className={`ivao-auto-eto ${draft.etoManual ? 'is-manual' : estimate?.status === 'ready' ? 'is-ready' : estimate?.status === 'waiting' ? 'is-waiting' : ''}`}>
                  {estimateText(estimate, draft.etoManual)}
                </small>
                {flight.route && <small className="ivao-traffic-fpl" title={flight.route}>{flight.route}</small>}
              </div>
              <div className="ivao-traffic-plan">
                <label><span>REF FIX{!draft.refFixManual && <em>AUTO</em>}</span><select value={draft.refFix} disabled={alreadyAdded || disabled} onChange={(event) => changeRefFix(flight, event.target.value)}>{fixes.map((fix) => <option key={fix} value={fix}>{fix}</option>)}</select></label>
                <label className="ivao-eto-label"><span>ETO UTC{!draft.etoManual && estimate?.status === 'ready' && <em>AUTO</em>}</span><input className={!draft.etoManual && estimate?.status === 'ready' ? 'is-auto' : ''} value={draft.eto} placeholder="HH:MM" inputMode="numeric" maxLength={5} disabled={alreadyAdded || disabled} onChange={(event) => changeEto(flight, event.target.value)} />{draft.etoManual && estimate?.status === 'ready' && <button type="button" className="ivao-use-auto" onClick={() => useAutoEto(flight)}>Use auto</button>}</label>
                <button type="button" className="ivao-traffic-add" disabled={!canAdd || adding === flight.sessionId} onClick={() => void add(flight)}>{alreadyAdded ? 'In sequence' : adding === flight.sessionId ? 'Adding…' : 'Add'}</button>
              </div>
            </article>
          })}
        </div>

        <div className="ivao-traffic-footer">
          <span>{fetchedAt ? `Updated ${new Date(fetchedAt).toISOString().slice(11, 19)}Z` : 'Waiting for IVAO data'} · AUTO ETO is a planning estimate</span>
          <span>{idle ? 'Auto-refresh paused · idle 10 min' : 'Auto-refresh 30s · panel open only'}</span>
        </div>
      </div>
    </details>
  )
}

export type { TrafficFlight }
