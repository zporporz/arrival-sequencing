import { useEffect, useMemo, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Airport = { id: string; icao: string; name: string; active: boolean }
type RunwayConfig = { id: string; airport_id: string; flow: string; label: string; timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'; active: boolean }
type StarProcedure = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  effective_from: string | null
  active: boolean
}
export type FixTiming = {
  id: number
  airport: string
  flow: string
  fix: string
  nominal_seconds: number
  source: string
  verified: boolean
  effective_from: string
  effective_to: string | null
  active: boolean
  runway_config_id: string | null
}

type Props = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  starProcedures?: StarProcedure[]
  fixTimings: FixTiming[]
  saving: boolean
  act: (body: Record<string, unknown>) => Promise<void>
}

type Draft = { minutes: string; source: string; verified: boolean; active: boolean }
type StarTimingDraft = {
  fix: string
  minutes: string
  source: string
  effectiveFrom: string
  designators: string[]
  origin: string
}

type WaypointTable = {
  airport: string
  runwayApplicability: string
  chartReference: string
  assetPath: string
}

const normalizeRunway = (value: string) => value
  .toUpperCase()
  .replace(/^RWY\s*/i, '')
  .replace(/\s*\/\s*/g, ' / ')
  .replace(/\s+/g, ' ')
  .trim()

const normalizeLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const LAT_RE = /(?:\d{6}(?:\.\d+)?|\d{2}\s+\d{2}\s+\d{2}(?:\.\d+)?)\s*[NS]\b/i
const LON_RE = /(?:\d{7}(?:\.\d+)?|\d{3}\s+\d{2}\s+\d{2}(?:\.\d+)?)\s*[EW]\b/i
const IGNORED_FIX_WORDS = new Set(['WAYPOINT', 'IDENTIFIER', 'LATITUDE', 'LONGITUDE', 'THAILAND', 'RNAV', 'STAR', 'RWY', 'ICAO', 'REMARKS', 'COURSE', 'DISTANCE', 'MAGNETIC'])

async function extractWaypointFixes(pdfBytes: ArrayBuffer) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise
  const fixes = new Set<string>()

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const points = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && 'transform' in item && Boolean(item.str.trim()))
      .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
      .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x)

    const rows: Array<{ y: number; items: typeof points }> = []
    for (const point of points) {
      let row = rows.find((candidate) => Math.abs(candidate.y - point.y) <= 2.5)
      if (!row) {
        row = { y: point.y, items: [] }
        rows.push(row)
      }
      row.items.push(point)
    }

    for (const row of rows) {
      const line = normalizeLine(row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ')).toUpperCase()
      const latMatch = line.match(LAT_RE)
      const lonMatch = line.match(LON_RE)
      if (!latMatch || !lonMatch || latMatch.index == null) continue

      const beforeCoordinates = line.slice(0, latMatch.index)
      const tokens = beforeCoordinates.match(/\b[A-Z][A-Z0-9]{2,7}\b/g) || []
      const candidate = [...tokens].reverse().find((token) => {
        if (IGNORED_FIX_WORDS.has(token)) return false
        if (/^RW\d{2}[LRC]?$/.test(token)) return false
        if (/^[A-Z]{2,6}\d[A-Z]$/.test(token)) return false
        if (/^AD\d*$/.test(token)) return false
        return true
      })
      if (candidate) fixes.add(candidate)
    }
  }

  return [...fixes].sort()
}

export default function TimingEditor({ airports, runwayConfigs, starProcedures = [], fixTimings, saving, act }: Props) {
  const [airportId, setAirportId] = useState('')
  const [runwayId, setRunwayId] = useState('')
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [starDrafts, setStarDrafts] = useState<Record<string, StarTimingDraft>>({})
  const [loadingAipWaypoints, setLoadingAipWaypoints] = useState(false)
  const [aipWaypointMessage, setAipWaypointMessage] = useState('')

  useEffect(() => {
    if (!airportId && airports.length) setAirportId(airports.find((a) => a.active)?.id || airports[0].id)
  }, [airports, airportId])

  const airport = useMemo(() => airports.find((a) => a.id === airportId) || null, [airports, airportId])
  const runways = useMemo(() => runwayConfigs.filter((r) => r.airport_id === airportId), [runwayConfigs, airportId])

  useEffect(() => {
    if (!runways.length) {
      setRunwayId('')
      return
    }
    if (!runways.some((r) => r.id === runwayId)) {
      setRunwayId(runways.find((r) => r.timing_status === 'ACTIVE')?.id || runways[0].id)
    }
  }, [runways, runwayId])

  const runway = useMemo(() => runways.find((r) => r.id === runwayId) || null, [runways, runwayId])
  const timings = useMemo(() => {
    if (!runway) return []
    return fixTimings.filter((t) => t.runway_config_id === runway.id || (!t.runway_config_id && t.airport === airport?.icao && t.flow === runway.flow))
  }, [fixTimings, runway, airport])

  const runwayStars = useMemo(() => {
    if (!runway) return []
    return starProcedures.filter((star) => star.runway_config_id === runway.id && star.active)
  }, [runway, starProcedures])

  const defaultEffectiveFrom = useMemo(() => {
    const dates = runwayStars.map((star) => star.effective_from).filter((value): value is string => Boolean(value)).sort()
    return dates.at(-1) || new Date().toISOString().slice(0, 10)
  }, [runwayStars])

  const starFixSuggestions = useMemo(() => {
    const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))
    const grouped = new Map<string, StarTimingDraft>()
    for (const star of runwayStars) {
      if (!star.entry_fix) continue
      const fix = star.entry_fix.trim().toUpperCase()
      if (!fix || existingFixes.has(fix)) continue
      const current = grouped.get(fix)
      const effectiveFrom = star.effective_from || defaultEffectiveFrom
      if (current) {
        if (!current.designators.includes(star.designator)) current.designators.push(star.designator)
        if (effectiveFrom > current.effectiveFrom) current.effectiveFrom = effectiveFrom
      } else {
        grouped.set(fix, {
          fix,
          minutes: '',
          source: '',
          effectiveFrom,
          designators: [star.designator],
          origin: `STAR entry: ${star.designator}`,
        })
      }
    }
    return [...grouped.values()].sort((left, right) => left.fix.localeCompare(right.fix))
  }, [runwayStars, timings, defaultEffectiveFrom])

  useEffect(() => {
    const next: Record<number, Draft> = {}
    for (const timing of timings) {
      next[timing.id] = {
        minutes: String(timing.nominal_seconds / 60),
        source: timing.source,
        verified: timing.verified,
        active: timing.active,
      }
    }
    setDrafts(next)
  }, [timings])

  useEffect(() => {
    setStarDrafts({})
    setAipWaypointMessage('')
  }, [runwayId])

  const changed = (timing: FixTiming) => {
    const draft = drafts[timing.id]
    if (!draft) return false
    return Number(draft.minutes) * 60 !== timing.nominal_seconds || draft.source !== timing.source || draft.verified !== timing.verified || draft.active !== timing.active
  }

  const save = async (timing: FixTiming) => {
    const draft = drafts[timing.id]
    if (!draft) return
    await act({
      action: 'timing.update',
      id: timing.id,
      nominalMinutes: Number(draft.minutes),
      source: draft.source,
      verified: draft.verified,
      active: draft.active,
    })
  }

  const addTiming = async () => {
    if (!airport || !runway) return
    const fix = window.prompt(`Reference fix for ${airport.icao} · ${runway.label}`)?.trim().toUpperCase()
    if (!fix) return
    const minutesText = window.prompt(`Nominal minutes from ${fix} to landing`)?.trim()
    if (!minutesText) return
    const nominalMinutes = Number(minutesText)
    if (!Number.isFinite(nominalMinutes) || nominalMinutes <= 0) {
      window.alert('Nominal minutes must be a positive number.')
      return
    }
    const source = window.prompt('Source / reference', 'Manual admin entry; provisional planning timing')?.trim()
    if (!source) return
    await act({
      action: 'timing.create',
      runwayConfigId: runway.id,
      airport: airport.icao,
      flow: runway.flow,
      fix,
      nominalMinutes,
      source,
      verified: false,
      active: true,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    })
  }

  const syncEntryFixes = () => {
    const next: Record<string, StarTimingDraft> = {}
    for (const suggestion of starFixSuggestions) next[suggestion.fix] = { ...suggestion, designators: [...suggestion.designators] }
    setStarDrafts(next)
    setAipWaypointMessage(`${Object.keys(next).length} STAR entry fixes loaded as drafts.`)
  }

  const loadAipWaypoints = async () => {
    if (!airport || !runway || !runwayStars.length) return
    setLoadingAipWaypoints(true)
    setAipWaypointMessage('Locating CAAT STAR waypoint list…')
    try {
      const tableResponse = await fetch(`/api/admin/aip-import?mode=waypoint-tables&airport=${encodeURIComponent(airport.icao)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const tablePayload = await tableResponse.json() as { tables?: WaypointTable[]; error?: string }
      if (!tableResponse.ok) throw new Error(tablePayload.error || `Waypoint lookup returned ${tableResponse.status}`)
      const matchingTables = (tablePayload.tables || []).filter((table) => normalizeRunway(table.runwayApplicability) === normalizeRunway(runway.label))
      if (!matchingTables.length) {
        syncEntryFixes()
        setAipWaypointMessage(`CAAT waypoint list table was not found for ${airport.icao} ${runway.label}; STAR entry fixes were loaded instead.`)
        return
      }

      const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))
      const next = new Map<string, StarTimingDraft>()
      for (const suggestion of starFixSuggestions) next.set(suggestion.fix, { ...suggestion, designators: [...suggestion.designators] })

      for (const table of matchingTables) {
        setAipWaypointMessage(`Reading ${table.chartReference} waypoint list…`)
        const assetResponse = await fetch(`/api/admin/aip-import?asset=${encodeURIComponent(table.assetPath)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!assetResponse.ok) {
          const payload = await assetResponse.json().catch(() => ({})) as { error?: string }
          throw new Error(payload.error || `${table.chartReference} returned ${assetResponse.status}`)
        }
        const fixes = await extractWaypointFixes(await assetResponse.arrayBuffer())
        for (const fix of fixes) {
          if (existingFixes.has(fix)) continue
          const entryStars = runwayStars.filter((star) => star.entry_fix?.toUpperCase() === fix).map((star) => star.designator)
          const current = next.get(fix)
          if (current) {
            current.origin = `${current.origin}; AIP waypoint list ${table.chartReference}`
            continue
          }
          next.set(fix, {
            fix,
            minutes: '',
            source: '',
            effectiveFrom: defaultEffectiveFrom,
            designators: entryStars,
            origin: `AIP waypoint list ${table.chartReference}`,
          })
        }
      }

      const sorted = [...next.values()].sort((left, right) => left.fix.localeCompare(right.fix))
      setStarDrafts(Object.fromEntries(sorted.map((draft) => [draft.fix, draft])))
      setAipWaypointMessage(`${sorted.length} unsaved REF FIX candidates loaded from CAAT STAR data. Nominal Min is still required.`)
    } catch (error) {
      setAipWaypointMessage(error instanceof Error ? `AIP waypoint load failed: ${error.message}` : `AIP waypoint load failed: ${String(error)}`)
    } finally {
      setLoadingAipWaypoints(false)
    }
  }

  const starDraftReady = (draft: StarTimingDraft) => {
    const minutes = Number(draft.minutes)
    return Number.isFinite(minutes) && minutes > 0 && minutes <= 180 && draft.source.trim().length > 0
  }

  const saveStarDraft = async (draft: StarTimingDraft) => {
    if (!airport || !runway || !starDraftReady(draft)) return
    await act({
      action: 'timing.create',
      runwayConfigId: runway.id,
      airport: airport.icao,
      flow: runway.flow,
      fix: draft.fix,
      nominalMinutes: Number(draft.minutes),
      source: draft.source.trim(),
      verified: false,
      active: true,
      effectiveFrom: draft.effectiveFrom,
    })
    setStarDrafts((current) => {
      const next = { ...current }
      delete next[draft.fix]
      return next
    })
  }

  const saveAllStarDrafts = async () => {
    const ready = Object.values(starDrafts).filter(starDraftReady)
    for (const draft of ready) await saveStarDraft(draft)
  }

  const starDraftList = Object.values(starDrafts)
  const readyStarDraftCount = starDraftList.filter(starDraftReady).length

  return (
    <section className="admin-card wide-card timing-editor">
      <div className="admin-card-heading timing-heading">
        <div>
          <span className="admin-label">LIVE TIMING DATA</span>
          <h2>Reference fix timing editor</h2>
          <p>Edits here change the same master timing dataset used by new arrivals. Existing flights keep their timing snapshot.</p>
        </div>
        <div className="timing-heading-actions">
          {runwayStars.length > 0 && starDraftList.length === 0 && <button disabled={saving || loadingAipWaypoints || !runway} onClick={() => void loadAipWaypoints()}>{loadingAipWaypoints ? 'Reading AIP waypoints…' : 'Load AIP STAR waypoints'}</button>}
          {starDraftList.length > 0 && <button className="primary-admin-action" disabled={saving || readyStarDraftCount === 0} onClick={() => void saveAllStarDrafts()}>Save ready drafts ({readyStarDraftCount})</button>}
          <button disabled={saving || !runway} onClick={() => void addTiming()}>+ Add timing</button>
        </div>
      </div>

      <div className="timing-workspace-bar">
        <label><span>AIRPORT</span><select value={airportId} onChange={(e) => setAirportId(e.target.value)}>{airports.map((a) => <option key={a.id} value={a.id}>{a.icao} · {a.name}</option>)}</select></label>
        <label><span>RUNWAY CONFIGURATION</span><select value={runwayId} onChange={(e) => setRunwayId(e.target.value)}>{runways.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.timing_status}</option>)}</select></label>
        {runway && <div className={`timing-config-state ${runway.timing_status.toLowerCase()}`}>{runway.timing_status === 'ACTIVE' ? 'TIMING ACTIVE' : runway.timing_status === 'PENDING' ? 'TIMING PENDING' : 'TIMING DISABLED'}</div>}
      </div>

      {aipWaypointMessage && <div className="timing-note"><strong>AIP:</strong> {aipWaypointMessage}</div>}

      {!runway ? <div className="admin-empty">Select a runway configuration.</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table timing-table">
            <thead><tr><th>REF FIX</th><th>NOMINAL MIN</th><th>SOURCE</th><th>VERIFIED</th><th>STATUS</th><th>EFFECTIVE</th><th /></tr></thead>
            <tbody>
              {timings.length === 0 && starDraftList.length === 0 ? <tr><td colSpan={7} className="admin-empty-cell">No timing records for this configuration. {runwayStars.length > 0 ? 'Use Load AIP STAR waypoints to prepare candidates from the official STAR waypoint list.' : 'Add one only when a planning timing is available.'}</td></tr> : timings.map((timing) => {
                const draft = drafts[timing.id]
                if (!draft) return null
                const isChanged = changed(timing)
                return <tr key={timing.id} className={!draft.active ? 'timing-row-inactive' : ''}>
                  <td><strong>{timing.fix}</strong><small>{timing.airport} · flow {timing.flow}</small></td>
                  <td><input className="timing-minutes" type="number" min="0.1" max="180" step="0.5" value={draft.minutes} onChange={(e) => setDrafts((all) => ({ ...all, [timing.id]: { ...draft, minutes: e.target.value } }))} /></td>
                  <td><input className="timing-source" value={draft.source} onChange={(e) => setDrafts((all) => ({ ...all, [timing.id]: { ...draft, source: e.target.value } }))} /></td>
                  <td><label className="admin-check"><input type="checkbox" checked={draft.verified} onChange={(e) => setDrafts((all) => ({ ...all, [timing.id]: { ...draft, verified: e.target.checked } }))} /><span>{draft.verified ? 'VERIFIED' : 'PROVISIONAL'}</span></label></td>
                  <td><label className="admin-check"><input type="checkbox" checked={draft.active} onChange={(e) => setDrafts((all) => ({ ...all, [timing.id]: { ...draft, active: e.target.checked } }))} /><span>{draft.active ? 'ACTIVE' : 'ARCHIVED'}</span></label></td>
                  <td><span className="timing-effective">{timing.effective_from}</span></td>
                  <td><button className={isChanged ? 'timing-save changed' : 'timing-save'} disabled={saving || !isChanged} onClick={() => void save(timing)}>{saving && isChanged ? 'Saving…' : 'Save'}</button></td>
                </tr>
              })}
              {starDraftList.map((draft) => <tr key={`star-draft-${draft.fix}`} className="timing-star-draft">
                <td><strong>{draft.fix}</strong><small>{draft.designators.length ? `STAR entry: ${draft.designators.join(', ')} · ` : ''}{draft.origin}</small></td>
                <td><input className="timing-minutes" type="number" min="0.1" max="180" step="0.5" placeholder="Required" value={draft.minutes} onChange={(e) => setStarDrafts((all) => ({ ...all, [draft.fix]: { ...draft, minutes: e.target.value } }))} /></td>
                <td><input className="timing-source" placeholder="Timing source / planning reference" value={draft.source} onChange={(e) => setStarDrafts((all) => ({ ...all, [draft.fix]: { ...draft, source: e.target.value } }))} /></td>
                <td><span className="timing-draft-state">PROVISIONAL</span></td>
                <td><span className="timing-draft-state">DRAFT</span></td>
                <td><input className="timing-effective-input" type="date" value={draft.effectiveFrom} onChange={(e) => setStarDrafts((all) => ({ ...all, [draft.fix]: { ...draft, effectiveFrom: e.target.value } }))} /></td>
                <td><button className={starDraftReady(draft) ? 'timing-save changed' : 'timing-save'} disabled={saving || !starDraftReady(draft)} onClick={() => void saveStarDraft(draft)}>Save</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      <div className="timing-note">AIP waypoint lists can supply <strong>REF FIX names only</strong>. <strong>Nominal Min still requires a planning source</strong>; no timing row is written until both a valid time and source are saved. <strong>Verified</strong> should only be enabled after the timing source has been checked.</div>
    </section>
  )
}
