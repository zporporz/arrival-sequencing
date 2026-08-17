from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch target: {label}")
    return text.replace(old, new, 1)

panel_path = Path('src/IvaoTrafficPanel.tsx')
panel = panel_path.read_text()

panel = replace_once(panel, """type Props = {
  airport: string
  fixes: string[]
  existingCallsigns: string[]
  disabled?: boolean
  onAdd: (flight: TrafficFlight, refFix: string, eto: string) => Promise<void>
}
""", """type TrafficAddItem = {
  flight: TrafficFlight
  refFix: string
  eto: string
}

type Props = {
  airport: string
  fixes: string[]
  existingCallsigns: string[]
  disabled?: boolean
  onAdd: (flight: TrafficFlight, refFix: string, eto: string) => Promise<void>
  onAddAll: (items: TrafficAddItem[]) => Promise<void>
}
""", 'panel props')

panel = replace_once(panel, """  assumedDirect?: boolean
  triggerSource?: 'live-route' | 'domestic-eet'
""", """  assumedDirect?: boolean
  autoAssignedFix?: boolean
  triggerSource?: 'live-route' | 'domestic-eet'
""", 'auto estimate type')

panel = replace_once(panel, """function suggestedFix(route: string | null, fixes: string[]) {
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
""", """function suggestedFix(route: string | null, fixes: string[]) {
  if (!fixes.length || !route) return ''
  const normalized = ` ${route.toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `
  let best = ''
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
""", 'suggestedFix')

panel = replace_once(panel, """function upcomingConfiguredFix(flight: TrafficFlight, geometry: RouteGeometry, fixes: string[]) {
  const progress = findRouteProgress(flight, geometry)
  if (!progress) return suggestedFix(flight.route, fixes)

  const ahead = fixes
    .map((fix) => ({ fix, distance: fixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => a.distance - b.distance)
  if (ahead[0]) return ahead[0].fix

  const passed = fixes
    .map((fix) => ({ fix, distance: passedFixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => b.distance - a.distance)
  return passed[0]?.fix || suggestedFix(flight.route, fixes)
}
""", """function upcomingConfiguredFix(flight: TrafficFlight, geometry: RouteGeometry, fixes: string[]) {
  const progress = findRouteProgress(flight, geometry)
  if (!progress) return suggestedFix(flight.route, fixes)

  const ahead = fixes
    .map((fix) => ({ fix, distance: fixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => a.distance - b.distance)
  if (ahead[0]) return ahead[0].fix

  const passed = fixes
    .map((fix) => ({ fix, distance: passedFixDistanceAlongRoute(geometry, fix, progress.progressNm) }))
    .filter((item): item is { fix: string; distance: number } => item.distance != null)
    .sort((a, b) => b.distance - a.distance)
  return passed[0]?.fix || suggestedFix(flight.route, fixes)
}

function remainingDistanceToFix(flight: TrafficFlight, geometry: RouteGeometry, fix: string) {
  const progress = findRouteProgress(flight, geometry)
  if (progress) {
    const target = fixDistanceAlongRoute(geometry, fix, progress.progressNm)
    if (target != null) return Math.max(0, target - progress.progressNm) + progress.offRouteNm
  }
  const distances = fixDistancesAlongRoute(geometry, fix)
  return distances.length ? distances[distances.length - 1] : null
}
""", 'remaining distance helper')

panel = replace_once(panel, """export default function IvaoTrafficPanel({ airport, fixes, existingCallsigns, disabled, onAdd }: Props) {
  const [flights, setFlights] = useState<TrafficFlight[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [autoEstimates, setAutoEstimates] = useState<Record<string, AutoEstimate>>({})
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
""", """export default function IvaoTrafficPanel({ airport, fixes, existingCallsigns, disabled, onAdd, onAddAll }: Props) {
  const [flights, setFlights] = useState<TrafficFlight[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [autoEstimates, setAutoEstimates] = useState<Record<string, AutoEstimate>>({})
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)
  const [locallyAddedCallsigns, setLocallyAddedCallsigns] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
""", 'component state')

panel = replace_once(panel, """  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])

  useEffect(() => {
""", """  const existing = useMemo(() => new Set(existingCallsigns.map((item) => item.toUpperCase())), [existingCallsigns])

  useEffect(() => {
    setLocallyAddedCallsigns((current) => {
      let changed = false
      const next = new Set(current)
      for (const callsign of current) {
        if (!existing.has(callsign)) continue
        next.delete(callsign)
        changed = true
      }
      return changed ? next : current
    })
  }, [existing])

  useEffect(() => {
""", 'local added confirmation')

panel = replace_once(panel, """  const refresh = useCallback(async () => {
""", """  const estimateForRefFix = useCallback(async (
    flight: TrafficFlight,
    geometry: RouteGeometry | null,
    refFix: string,
    groundSpeed: number | null,
    baseTimeIso: string,
    autoAssignedFix = false,
  ) => {
    let estimate = autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin)
    if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route' && refFix) {
      const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
      if (assumedGeometry) {
        const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, groundSpeed, baseTimeIso, lookaheadMin)
        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix }
      }
    }
    return estimate
  }, [getAssumedRouteGeometry, lookaheadMin])

  const autoAssignUnfiledFix = useCallback(async (
    flight: TrafficFlight,
    geometry: RouteGeometry | null,
    groundSpeed: number | null,
    baseTimeIso: string,
  ) => {
    if (!geometry || !fixes.length) return null
    if (fixes.some((fix) => fixDistancesAlongRoute(geometry, fix).length > 0)) return null

    const candidates = await Promise.all(fixes.map(async (fix) => {
      const assumedGeometry = await getAssumedRouteGeometry(flight, fix)
      if (!assumedGeometry) return null
      const score = remainingDistanceToFix(flight, assumedGeometry, fix)
      if (score == null || !Number.isFinite(score)) return null
      const estimate = autoEstimate(flight, assumedGeometry, fix, groundSpeed, baseTimeIso, lookaheadMin)
      return {
        refFix: fix,
        score,
        estimate: { ...estimate, assumedDirect: true, autoAssignedFix: true } as AutoEstimate,
      }
    }))

    return candidates
      .filter((candidate): candidate is { refFix: string; score: number; estimate: AutoEstimate } => candidate != null)
      .sort((left, right) => left.score - right.score)[0] ?? null
  }, [fixes, getAssumedRouteGeometry, lookaheadMin])

  const refresh = useCallback(async () => {
""", 'auto assign helpers')

old_loop = """      for (const flight of nextFlights) {
        const geometry = geometries.get(flight.sessionId) ?? null
        const previous = currentDrafts[flight.sessionId]
        const suggested = geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes)
        const refFix = previous?.refFixManual ? previous.refFix : (suggested || previous?.refFix || fixes[0] || '')
        const gs = smoothedGroundSpeed(flight)
        let estimate = autoEstimate(flight, geometry, refFix, gs, nextFetchedAt, lookaheadMin)
        if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route' && refFix) {
          const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
          if (assumedGeometry) {
            const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, gs, nextFetchedAt, lookaheadMin)
            if (assumedEstimate.status === 'ready' || assumedEstimate.status === 'waiting') {
              estimate = { ...assumedEstimate, assumedDirect: true }
            }
          }
        }
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
"""
new_loop = """      for (const flight of nextFlights) {
        const geometry = geometries.get(flight.sessionId) ?? null
        const previous = currentDrafts[flight.sessionId]
        const gs = smoothedGroundSpeed(flight)
        const filedSuggested = geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes)
        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested
        let estimate: AutoEstimate | null = null

        if (previous?.refFixManual) {
          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, false)
        } else if (filedSuggested) {
          estimate = autoEstimate(flight, geometry, filedSuggested, gs, nextFetchedAt, lookaheadMin)
        } else if (previous?.refFix && fixes.includes(previous.refFix)) {
          refFix = previous.refFix
          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, true)
        } else {
          const assigned = await autoAssignUnfiledFix(flight, geometry, gs, nextFetchedAt)
          if (assigned) {
            refFix = assigned.refFix
            estimate = assigned.estimate
          }
        }

        if (!refFix) refFix = fixes[0] || ''
        if (!estimate) estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, !filedSuggested)

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
"""
panel = replace_once(panel, old_loop, new_loop, 'refresh loop')

panel = replace_once(panel, """  }, [airport, fixes, getAssumedRouteGeometry, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])
""", """  }, [airport, autoAssignUnfiledFix, estimateForRefFix, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])
""", 'refresh dependencies')

old_change = """  const changeRefFix = async (flight: TrafficFlight, refFix: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix, eto: '', refFixManual: false, etoManual: false }
    const geometry = geometryCacheRef.current.get(routeKey(flight, airport)) ?? null
    const gsSamples = gsHistoryRef.current.get(flight.sessionId) || []
    const gs = gsSamples.length ? gsSamples.reduce((sum, value) => sum + value, 0) / gsSamples.length : flight.groundSpeed
    const baseTime = fetchedAt || new Date().toISOString()
    let estimate = autoEstimate(flight, geometry, refFix, gs, baseTime, lookaheadMin)
    if (estimate.status === 'unavailable' && estimate.reason === 'REF FIX not in filed route') {
      const assumedGeometry = await getAssumedRouteGeometry(flight, refFix)
      if (assumedGeometry) {
        const assumedEstimate = autoEstimate(flight, assumedGeometry, refFix, gs, baseTime, lookaheadMin)
        if (assumedEstimate.status === 'ready' || assumedEstimate.status === 'waiting') {
          estimate = { ...assumedEstimate, assumedDirect: true }
        }
      }
    }
    const nextDraft = {
"""
new_change = """  const changeRefFix = async (flight: TrafficFlight, refFix: string) => {
    const current = draftsRef.current[flight.sessionId] || { refFix, eto: '', refFixManual: false, etoManual: false }
    const geometry = geometryCacheRef.current.get(routeKey(flight, airport)) ?? null
    const gsSamples = gsHistoryRef.current.get(flight.sessionId) || []
    const gs = gsSamples.length ? gsSamples.reduce((sum, value) => sum + value, 0) / gsSamples.length : flight.groundSpeed
    const baseTime = fetchedAt || new Date().toISOString()
    const estimate = await estimateForRefFix(flight, geometry, refFix, gs, baseTime, false)
    const nextDraft = {
"""
panel = replace_once(panel, old_change, new_change, 'changeRefFix')

panel = replace_once(panel, """  const add = async (flight: TrafficFlight) => {
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
""", """  const bulkItems = useMemo<TrafficAddItem[]>(() => {
    if (disabled) return []
    return flights.flatMap((flight) => {
      const callsign = flight.callsign.toUpperCase()
      if (existing.has(callsign) || locallyAddedCallsigns.has(callsign)) return []
      const draft = drafts[flight.sessionId]
      if (!draft?.refFix || !validTime(draft.eto)) return []
      return [{ flight, refFix: draft.refFix, eto: draft.eto }]
    })
  }, [disabled, drafts, existing, flights, locallyAddedCallsigns])

  const add = async (flight: TrafficFlight) => {
    const draft = drafts[flight.sessionId]
    if (!draft || !draft.refFix || !validTime(draft.eto)) return
    setAdding(flight.sessionId)
    setError(null)
    setBulkNotice(null)
    try {
      await onAdd(flight, draft.refFix, draft.eto)
      setLocallyAddedCallsigns((current) => new Set(current).add(flight.callsign.toUpperCase()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(null)
    }
  }

  const addAll = async () => {
    if (!bulkItems.length || bulkAdding) return
    const eligibleFlights = flights.filter((flight) => {
      const callsign = flight.callsign.toUpperCase()
      return !existing.has(callsign) && !locallyAddedCallsigns.has(callsign)
    }).length
    setBulkAdding(true)
    setBulkNotice(null)
    setError(null)
    try {
      await onAddAll(bulkItems)
      setLocallyAddedCallsigns((current) => {
        const next = new Set(current)
        for (const item of bulkItems) next.add(item.flight.callsign.toUpperCase())
        return next
      })
      const skipped = Math.max(0, eligibleFlights - bulkItems.length)
      setBulkNotice(`Added ${bulkItems.length} flight${bulkItems.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} waiting/unavailable` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkAdding(false)
    }
  }

  return (
""", 'bulk add functions')

panel = replace_once(panel, """      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + domesticEta
""", """      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta
""", 'manual assumed label')

panel = replace_once(panel, """      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · REF FIX NOT FILED · ASSUMED DCT' + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
""", """      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT' + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta
""", 'ready assumed label')

panel = replace_once(panel, """      const assumed = estimate.assumedDirect ? ' · REF FIX NOT FILED · ASSUMED DCT' : ''
""", """      const assumed = estimate.assumedDirect ? ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT' : ''
""", 'domestic waiting assumed label')

panel = replace_once(panel, """    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED · ASSUMED DCT · ETA >' + lookaheadMin + ' min'
""", """    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'
""", 'waiting assumed label')

panel = replace_once(panel, """            <span>AUTO ETO uses filed-route distance + live GS. Thailand domestic flights use tracked wheels-off + filed EET for the look-ahead trigger. If the selected REF FIX is not filed, the system may extend the filed route with an assumed DCT to that fix and labels the estimate accordingly.</span>
""", """            <span>AUTO ETO uses filed-route distance + live GS. Thailand domestic flights use tracked wheels-off + filed EET for the look-ahead trigger. Filed STAR/REF FIX is preferred; when none is filed, the system auto-assigns the shortest usable configured REF FIX using an assumed-DCT continuation.</span>
""", 'heading description')

panel = replace_once(panel, """            <button type=\"button\" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

        {error && <div className=\"ivao-traffic-error\">{error}</div>}
""", """            <button type=\"button\" onClick={manualRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            <button type=\"button\" className=\"ivao-add-all\" onClick={() => void addAll()} disabled={disabled || bulkAdding || bulkItems.length === 0} title=\"Add every IVAO arrival with a valid ETO; waiting or unavailable flights are skipped\">{bulkAdding ? 'Adding…' : `Add All${bulkItems.length ? ` (${bulkItems.length})` : ''}`}</button>
          </div>
        </div>

        {bulkNotice && <div className=\"ivao-bulk-notice\">{bulkNotice}</div>}
        {error && <div className=\"ivao-traffic-error\">{error}</div>}
""", 'add all button')

panel = replace_once(panel, """            const alreadyAdded = existing.has(flight.callsign.toUpperCase())
            const canAdd = !disabled && !alreadyAdded && Boolean(draft.refFix) && validTime(draft.eto)
""", """            const callsign = flight.callsign.toUpperCase()
            const alreadyAdded = existing.has(callsign) || locallyAddedCallsigns.has(callsign)
            const canAdd = !disabled && !bulkAdding && !alreadyAdded && Boolean(draft.refFix) && validTime(draft.eto)
""", 'row added state')

panel = replace_once(panel, """export type { TrafficFlight }
""", """export type { TrafficAddItem, TrafficFlight }
""", 'exports')

panel_path.write_text(panel)

app_path = Path('src/App.tsx')
app = app_path.read_text()
app = replace_once(app, """import IvaoTrafficPanel, { type TrafficFlight } from './IvaoTrafficPanel'
""", """import IvaoTrafficPanel, { type TrafficAddItem, type TrafficFlight } from './IvaoTrafficPanel'
""", 'app import')

app = replace_once(app, """  const addIvaoFlight = async (flight: TrafficFlight, refFix: string, eto: string) => {
    if (!session) throw new Error('No active sequence session')
    const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
    await sequenceApi('/api/sequence/arrival', {
      action: 'create',
      sessionId: session.id,
      sequenceNo,
      callsign: flight.callsign,
      aircraftType: flight.aircraft,
      departure: flight.departure,
      refFix,
      eto: isoFromClock(session.service_date, eto, new Date().toISOString()),
    })
  }

  const deleteFlight = async (row: ArrivalView) => {
""", """  const addIvaoFlight = async (flight: TrafficFlight, refFix: string, eto: string) => {
    if (!session) throw new Error('No active sequence session')
    const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
    await sequenceApi('/api/sequence/arrival', {
      action: 'create',
      sessionId: session.id,
      sequenceNo,
      callsign: flight.callsign,
      aircraftType: flight.aircraft,
      departure: flight.departure,
      refFix,
      eto: isoFromClock(session.service_date, eto, new Date().toISOString()),
    })
  }

  const addIvaoFlights = async (items: TrafficAddItem[]) => {
    if (!session) throw new Error('No active sequence session')
    let sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1
    for (const item of items) {
      await sequenceApi('/api/sequence/arrival', {
        action: 'create',
        sessionId: session.id,
        sequenceNo,
        callsign: item.flight.callsign,
        aircraftType: item.flight.aircraft,
        departure: item.flight.departure,
        refFix: item.refFix,
        eto: isoFromClock(session.service_date, item.eto, new Date().toISOString()),
      })
      sequenceNo += 1
    }
  }

  const deleteFlight = async (row: ArrivalView) => {
""", 'app bulk callback')

app = replace_once(app, """                onAdd={addIvaoFlight}
              />}
""", """                onAdd={addIvaoFlight}
                onAddAll={addIvaoFlights}
              />}
""", 'app panel prop')
app_path.write_text(app)

css_path = Path('src/ivaoTraffic.css')
css = css_path.read_text()
css = replace_once(css, """.ivao-traffic-heading button {
  border: 1px solid #dfe5ee;
  background: #fff;
  border-radius: 9px;
  padding: 7px 10px;
  color: #33415a;
  font-size: 10px;
  font-weight: 750;
}
.ivao-traffic-error { padding: 11px 16px; background: #fff2ef; color: #a34538; border-bottom: 1px solid #f4d9d4; font-size: 11px; }
""", """.ivao-traffic-heading button {
  border: 1px solid #dfe5ee;
  background: #fff;
  border-radius: 9px;
  padding: 7px 10px;
  color: #33415a;
  font-size: 10px;
  font-weight: 750;
}
.ivao-traffic-heading button.ivao-add-all {
  border-color: #2d6fd8;
  background: #2d6fd8;
  color: #fff;
  min-width: 82px;
}
.ivao-traffic-heading button.ivao-add-all:disabled {
  border-color: #d8dfeb;
  background: #edf1f6;
  color: #98a3b5;
}
.ivao-bulk-notice { padding: 8px 16px; background: #eef8f2; color: #28734c; border-bottom: 1px solid #dceee3; font-size: 10px; font-weight: 750; }
.ivao-traffic-error { padding: 11px 16px; background: #fff2ef; color: #a34538; border-bottom: 1px solid #f4d9d4; font-size: 11px; }
""", 'bulk css')
css_path.write_text(css)

readme_path = Path('README.md')
readme = readme_path.read_text()
readme = replace_once(readme, """## 18. Manual AUTO ETO override

- Controller can type ETO manually at any time.
- Manual input is preserved during automatic refreshes.
- If an automatic estimate later becomes available, the panel offers `Use auto` to return to the automatic value.
- Changing REF FIX manually recalculates the automatic estimate for that fix, including the assumed-DCT fallback when applicable.
""", """## 18. Manual AUTO ETO override

- Controller can type ETO manually at any time.
- Manual input is preserved during automatic refreshes.
- If an automatic estimate later becomes available, the panel offers `Use auto` to return to the automatic value.
- Changing REF FIX manually recalculates the automatic estimate for that fix, including the assumed-DCT fallback when applicable.

### Add All and automatic unfiled REF FIX assignment

- The IVAO Traffic panel includes `Add All (N)` for bulk insertion of every non-duplicate flight that currently has a valid REF FIX and ETO.
- Bulk insertion assigns consecutive sequence numbers so multiple rows can be created safely in one action.
- Flights that are still outside the selected AUTO ETO window, waiting for domestic tracked takeoff, or otherwise unavailable are skipped and remain visible for later addition.
- When a configured STAR entry / REF FIX is present in the resolved filed route, that filed fix is preferred.
- When no configured REF FIX is filed, the panel evaluates each configured fix using an assumed-DCT continuation and automatically selects the usable candidate with the shortest remaining distance to the fix.
- Auto-selected unfiled fixes are explicitly labelled `REF FIX NOT FILED · AUTO ASSIGNED · ASSUMED DCT`.
- This automatic assignment is a sequencing-planning fallback only. It does not modify the pilot's IVAO flight plan and does not represent an ATC STAR clearance.
""", 'readme bulk section')
readme_path.write_text(readme)

print('patched Add All, automatic unfiled REF FIX assignment, App bulk sequencing, CSS, README')
