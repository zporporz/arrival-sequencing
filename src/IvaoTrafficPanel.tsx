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

type Draft = { refFix: string; eto: string }

const AUTO_REFRESH_MS = 30_000
const IDLE_TIMEOUT_MS = 10 * 60_000
const IDLE_CHECK_MS = 15_000

const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)

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
  if (flight.altitude != null) parts.push(`FL/ALT ${Math.round(flight.altitude)}`)
  if (flight.groundSpeed != null) parts.push(`${Math.round(flight.groundSpeed)} kt`)
  if (flight.state) parts.push(flight.state)
  return parts.join(' · ') || 'Online'
}

export default function IvaoTrafficPanel({ airport, fixes, existingCallsigns, disabled, onAdd }: Props) {
  const [flights, setFlights] = useState<TrafficFlight[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [idle, setIdle] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const idleRef = useRef(false)
  const refreshInFlightRef = useRef(false)

  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])

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
      setFlights(nextFlights)
      setFetchedAt(payload.fetchedAt || new Date().toISOString())
      setDrafts((current) => {
        const next: Record<string, Draft> = {}
        for (const flight of nextFlights) {
          next[flight.sessionId] = current[flight.sessionId] || {
            refFix: suggestedFix(flight.route, fixes),
            eto: '',
          }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      refreshInFlightRef.current = false
      setLoading(false)
    }
  }, [airport, fixes])

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
            <span>Live network traffic. Set REF FIX and ETO before adding.</span>
          </div>
          <button type="button" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        {error && <div className="ivao-traffic-error">{error}</div>}
        {!error && flights.length === 0 && <div className="ivao-traffic-empty">No connected IVAO arrivals to {airport}.</div>}

        <div className="ivao-traffic-list">
          {flights.map((flight) => {
            const draft = drafts[flight.sessionId] || { refFix: fixes[0] || '', eto: '' }
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
                {flight.route && <small className="ivao-traffic-fpl" title={flight.route}>{flight.route}</small>}
              </div>
              <div className="ivao-traffic-plan">
                <label><span>REF FIX</span><select value={draft.refFix} disabled={alreadyAdded || disabled} onChange={(event) => setDrafts((all) => ({ ...all, [flight.sessionId]: { ...draft, refFix: event.target.value } }))}>{fixes.map((fix) => <option key={fix} value={fix}>{fix}</option>)}</select></label>
                <label><span>ETO UTC</span><input value={draft.eto} placeholder="HH:MM" inputMode="numeric" maxLength={5} disabled={alreadyAdded || disabled} onChange={(event) => setDrafts((all) => ({ ...all, [flight.sessionId]: { ...draft, eto: event.target.value.replace(/[^0-9:]/g, '').slice(0, 5) } }))} /></label>
                <button type="button" className="ivao-traffic-add" disabled={!canAdd || adding === flight.sessionId} onClick={() => void add(flight)}>{alreadyAdded ? 'In sequence' : adding === flight.sessionId ? 'Adding…' : 'Add'}</button>
              </div>
            </article>
          })}
        </div>

        <div className="ivao-traffic-footer">
          <span>{fetchedAt ? `Updated ${new Date(fetchedAt).toISOString().slice(11, 19)}Z` : 'Waiting for IVAO data'}</span>
          <span>{idle ? 'Auto-refresh paused · idle 10 min' : 'Auto-refresh 30s · panel open only'}</span>
        </div>
      </div>
    </details>
  )
}

export type { TrafficFlight }
