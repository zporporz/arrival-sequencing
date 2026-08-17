import { useEffect, useMemo, useState, type ReactNode } from 'react'

type TrafficSummaryFlight = {
  sessionId: string
  callsign: string
  aircraft: string | null
  departure: string | null
  arrival: string | null
  route: string | null
  state: string | null
}

type DepartureSummaryFlight = {
  sessionId: string
  callsign: string
  aircraft: string | null
  arrival: string | null
  route: string | null
  state: string | null
  eobt: string | null
}

type SummaryPayload = {
  airport?: string
  fetchedAt?: string
  inbound?: TrafficSummaryFlight[]
  departures?: DepartureSummaryFlight[]
  error?: string
}

type Props = {
  airport: string
  existingCallsigns: string[]
  importControl?: ReactNode
}

const formatTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const compact = value.trim().replace(/[^0-9]/g, '')
  if (/^\d{4}$/.test(compact)) return `${compact.slice(0, 2)}:${compact.slice(2)}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

const routeTail = (route: string | null) => {
  if (!route) return '—'
  const tokens = route.trim().split(/\s+/).filter(Boolean)
  return tokens.slice(-4).join(' ')
}

export default function AmanTrafficSummary({ airport, existingCallsigns, importControl }: Props) {
  const [payload, setPayload] = useState<SummaryPayload>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer = 0

    const refresh = async () => {
      try {
        const response = await fetch(`/api/sequence/ivao-summary?airport=${encodeURIComponent(airport)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const next = await response.json() as SummaryPayload
        if (!response.ok) throw new Error(next.error || `IVAO traffic returned ${response.status}`)
        if (!cancelled) {
          setPayload(next)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void refresh()
    timer = window.setInterval(() => void refresh(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [airport])

  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.trim().toUpperCase())), [existingCallsigns])
  const inbound = (payload.inbound || []).filter((flight) => !existing.has(flight.callsign.toUpperCase()))
  const departures = payload.departures || []

  return (
    <div className="aman-side-stack">
      <section className="aman-side-panel aman-inbound-panel">
        <div className="aman-side-panel-head">
          <div>
            <span>LIVE IVAO</span>
            <h3>Inbound · not yet in sequence</h3>
          </div>
          <b>{inbound.length}</b>
        </div>
        {importControl && <div className="aman-import-control">{importControl}</div>}
        {loading ? <div className="aman-panel-empty">Loading inbound traffic…</div> : error ? <div className="aman-panel-error">{error}</div> : inbound.length === 0 ? <div className="aman-panel-empty">No unsequenced inbound flights.</div> : (
          <div className="aman-side-table-wrap">
            <table className="aman-side-table">
              <thead><tr><th>CALLSIGN</th><th>TYPE</th><th>DEP</th><th>STATE</th></tr></thead>
              <tbody>{inbound.slice(0, 12).map((flight) => <tr key={flight.sessionId}><td><strong>{flight.callsign}</strong></td><td>{flight.aircraft || '—'}</td><td>{flight.departure || '—'}</td><td>{flight.state || 'Online'}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="aman-side-panel aman-departure-panel">
        <div className="aman-side-panel-head">
          <div>
            <span>{airport}</span>
            <h3>Departure · EOBT</h3>
          </div>
          <b>{departures.length}</b>
        </div>
        {loading ? <div className="aman-panel-empty">Loading departures…</div> : error ? <div className="aman-panel-error">{error}</div> : departures.length === 0 ? <div className="aman-panel-empty">No connected departures on ground.</div> : (
          <div className="aman-side-table-wrap">
            <table className="aman-side-table">
              <thead><tr><th>CALLSIGN</th><th>TYPE</th><th>EOBT</th><th>DEST</th><th>ROUTE</th></tr></thead>
              <tbody>{departures.slice(0, 10).map((flight) => <tr key={flight.sessionId}><td><strong>{flight.callsign}</strong></td><td>{flight.aircraft || '—'}</td><td>{formatTime(flight.eobt)}</td><td>{flight.arrival || '—'}</td><td className="aman-route-tail" title={flight.route || ''}>{routeTail(flight.route)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className="aman-side-update">Updated {formatTime(payload.fetchedAt)}Z · summary refresh 30s</div>
    </div>
  )
}
