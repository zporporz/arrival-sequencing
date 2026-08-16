import { useEffect, useMemo, useState } from 'react'

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
  starProcedures: StarProcedure[]
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
}

export default function TimingEditor({ airports, runwayConfigs, starProcedures, fixTimings, saving, act }: Props) {
  const [airportId, setAirportId] = useState('')
  const [runwayId, setRunwayId] = useState('')
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [starDrafts, setStarDrafts] = useState<Record<string, StarTimingDraft>>({})

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

  const starFixSuggestions = useMemo(() => {
    if (!runway) return [] as StarTimingDraft[]
    const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))
    const grouped = new Map<string, StarTimingDraft>()
    for (const star of starProcedures) {
      if (star.runway_config_id !== runway.id || !star.active || !star.entry_fix) continue
      const fix = star.entry_fix.trim().toUpperCase()
      if (!fix || existingFixes.has(fix)) continue
      const current = grouped.get(fix)
      const effectiveFrom = star.effective_from || new Date().toISOString().slice(0, 10)
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
        })
      }
    }
    return [...grouped.values()].sort((left, right) => left.fix.localeCompare(right.fix))
  }, [runway, timings, starProcedures])

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

  const syncStarFixes = () => {
    const next: Record<string, StarTimingDraft> = {}
    for (const suggestion of starFixSuggestions) next[suggestion.fix] = { ...suggestion, designators: [...suggestion.designators] }
    setStarDrafts(next)
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
          {starFixSuggestions.length > 0 && starDraftList.length === 0 && <button disabled={saving || !runway} onClick={syncStarFixes}>Sync reference fixes from STAR ({starFixSuggestions.length})</button>}
          {starDraftList.length > 0 && <button className="primary-admin-action" disabled={saving || readyStarDraftCount === 0} onClick={() => void saveAllStarDrafts()}>Save ready drafts ({readyStarDraftCount})</button>}
          <button disabled={saving || !runway} onClick={() => void addTiming()}>+ Add timing</button>
        </div>
      </div>

      <div className="timing-workspace-bar">
        <label><span>AIRPORT</span><select value={airportId} onChange={(e) => setAirportId(e.target.value)}>{airports.map((a) => <option key={a.id} value={a.id}>{a.icao} · {a.name}</option>)}</select></label>
        <label><span>RUNWAY CONFIGURATION</span><select value={runwayId} onChange={(e) => setRunwayId(e.target.value)}>{runways.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.timing_status}</option>)}</select></label>
        {runway && <div className={`timing-config-state ${runway.timing_status.toLowerCase()}`}>{runway.timing_status === 'ACTIVE' ? 'TIMING ACTIVE' : runway.timing_status === 'PENDING' ? 'TIMING PENDING' : 'TIMING DISABLED'}</div>}
      </div>

      {!runway ? <div className="admin-empty">Select a runway configuration.</div> : (
        <div className="admin-table-wrap">
          <table className="admin-table timing-table">
            <thead><tr><th>REF FIX</th><th>NOMINAL MIN</th><th>SOURCE</th><th>VERIFIED</th><th>STATUS</th><th>EFFECTIVE</th><th /></tr></thead>
            <tbody>
              {timings.length === 0 && starDraftList.length === 0 ? <tr><td colSpan={7} className="admin-empty-cell">No timing records for this configuration. {starFixSuggestions.length > 0 ? `${starFixSuggestions.length} reference fixes are available from imported STAR data.` : 'Add one only when a planning timing is available.'}</td></tr> : timings.map((timing) => {
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
                <td><strong>{draft.fix}</strong><small>From STAR: {draft.designators.join(', ')}</small></td>
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
      <div className="timing-note">Reference-fix names may be prepared from imported STAR data, but <strong>Nominal Min still requires a planning source</strong>. Sync creates browser drafts only; no timing is written until a valid time and source are saved. <strong>Verified</strong> should only be enabled after the timing source has been checked.</div>
    </section>
  )
}
