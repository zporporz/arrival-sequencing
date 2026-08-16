import { useEffect, useMemo, useState } from 'react'

type Airport = {
  id: string
  icao: string
  name: string
  active: boolean
  published: boolean
}

type RunwayConfig = {
  id: string
  airport_id: string
  flow: string
  label: string
  timing_status: 'ACTIVE' | 'PENDING' | 'DISABLED'
  active: boolean
  published: boolean
}

type StarProcedure = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  runway_applicability: string | null
  chart_reference: string | null
  source: string | null
  effective_from: string | null
  effective_to: string | null
  active: boolean
}

type Props = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  starProcedures: StarProcedure[]
  selectedAirportId: string
  onAirportChange: (id: string) => void
  saving: boolean
  act: (body: Record<string, unknown>) => Promise<void>
}

type Draft = {
  designator: string
  entryFix: string
  runwayApplicability: string
  chartReference: string
  source: string
  effectiveFrom: string
  effectiveTo: string
  active: boolean
}

const today = () => new Date().toISOString().slice(0, 10)

export default function StarEditor({ airports, runwayConfigs, starProcedures, selectedAirportId, onAirportChange, saving, act }: Props) {
  const [runwayId, setRunwayId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createRunwayId, setCreateRunwayId] = useState('')
  const [createDesignator, setCreateDesignator] = useState('')
  const [createEntryFix, setCreateEntryFix] = useState('')
  const [createApplicability, setCreateApplicability] = useState('')
  const [createChart, setCreateChart] = useState('')
  const [createSource, setCreateSource] = useState('Manual admin entry')
  const [createEffective, setCreateEffective] = useState(today())
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const airport = useMemo(() => airports.find((item) => item.id === selectedAirportId) ?? null, [airports, selectedAirportId])
  const runways = useMemo(() => runwayConfigs.filter((item) => item.airport_id === selectedAirportId), [runwayConfigs, selectedAirportId])

  useEffect(() => {
    if (!runways.length) {
      setRunwayId('')
      setCreateRunwayId('')
      return
    }
    if (!runways.some((item) => item.id === runwayId)) setRunwayId(runways[0].id)
    if (!runways.some((item) => item.id === createRunwayId)) setCreateRunwayId(runways[0].id)
  }, [runways, runwayId, createRunwayId])

  const visibleStars = useMemo(() => {
    const runwayIds = new Set(runways.map((item) => item.id))
    return starProcedures
      .filter((item) => runwayIds.has(item.runway_config_id))
      .filter((item) => !runwayId || item.runway_config_id === runwayId)
      .sort((left, right) => left.designator.localeCompare(right.designator))
  }, [starProcedures, runways, runwayId])

  useEffect(() => {
    const next: Record<string, Draft> = {}
    for (const star of visibleStars) {
      next[star.id] = {
        designator: star.designator,
        entryFix: star.entry_fix ?? '',
        runwayApplicability: star.runway_applicability ?? '',
        chartReference: star.chart_reference ?? '',
        source: star.source ?? '',
        effectiveFrom: star.effective_from ?? '',
        effectiveTo: star.effective_to ?? '',
        active: star.active,
      }
    }
    setDrafts(next)
  }, [visibleStars])

  const changed = (star: StarProcedure) => {
    const draft = drafts[star.id]
    if (!draft) return false
    return draft.designator !== star.designator ||
      draft.entryFix !== (star.entry_fix ?? '') ||
      draft.runwayApplicability !== (star.runway_applicability ?? '') ||
      draft.chartReference !== (star.chart_reference ?? '') ||
      draft.source !== (star.source ?? '') ||
      draft.effectiveFrom !== (star.effective_from ?? '') ||
      draft.effectiveTo !== (star.effective_to ?? '') ||
      draft.active !== star.active
  }

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  const saveStar = async (star: StarProcedure) => {
    const draft = drafts[star.id]
    if (!draft) return
    if (!draft.designator.trim()) {
      window.alert('STAR designator is required.')
      return
    }
    await act({
      action: 'star.update',
      id: star.id,
      designator: draft.designator.trim().toUpperCase(),
      entryFix: draft.entryFix.trim().toUpperCase() || null,
      runwayApplicability: draft.runwayApplicability.trim() || null,
      chartReference: draft.chartReference.trim() || null,
      source: draft.source.trim() || null,
      effectiveFrom: draft.effectiveFrom || null,
      effectiveTo: draft.effectiveTo || null,
      active: draft.active,
    })
  }

  const resetCreate = () => {
    setCreateDesignator('')
    setCreateEntryFix('')
    setCreateApplicability('')
    setCreateChart('')
    setCreateSource('Manual admin entry')
    setCreateEffective(today())
    setShowCreate(false)
  }

  const createStar = async () => {
    if (!createRunwayId || !createDesignator.trim()) {
      window.alert('Runway configuration and STAR designator are required.')
      return
    }
    await act({
      action: 'star.create',
      runwayConfigId: createRunwayId,
      designator: createDesignator.trim().toUpperCase(),
      entryFix: createEntryFix.trim().toUpperCase() || null,
      runwayApplicability: createApplicability.trim() || null,
      chartReference: createChart.trim() || null,
      source: createSource.trim() || 'Manual admin entry',
      effectiveFrom: createEffective || today(),
      active: true,
    })
    resetCreate()
  }

  return (
    <section className="admin-card wide-card star-editor">
      <div className="admin-card-heading star-editor-heading">
        <div>
          <span className="admin-label">STAR PROCEDURES · OPTIONAL</span>
          <h2>{airport ? `${airport.icao} procedures` : 'Select airport'}</h2>
          <p>Only store published source-backed procedures. If an airport has no STAR, leave this section empty.</p>
        </div>
        <div className="star-actions">
          <select value={selectedAirportId} onChange={(event) => onAirportChange(event.target.value)}>
            {airports.map((item) => <option key={item.id} value={item.id}>{item.icao} · {item.name}</option>)}
          </select>
          <button disabled={saving || runways.length === 0} onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'Close' : '+ Add STAR'}</button>
        </div>
      </div>

      <div className="star-filter-bar">
        <label>
          <span>RUNWAY CONFIGURATION</span>
          <select value={runwayId} onChange={(event) => setRunwayId(event.target.value)} disabled={!runways.length}>
            {runways.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.published ? 'PUBLISHED' : 'NOT PUBLISHED'}</option>)}
          </select>
        </label>
        <div className="star-count"><strong>{visibleStars.length}</strong><span>STAR records</span></div>
      </div>

      {showCreate && (
        <div className="star-create-panel">
          <div className="star-create-title"><strong>New STAR procedure</strong><span>Every change is stored in configuration history.</span></div>
          <div className="star-create-grid">
            <label><span>RUNWAY CONFIG</span><select value={createRunwayId} onChange={(event) => setCreateRunwayId(event.target.value)}>{runways.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label><span>STAR DESIGNATOR</span><input value={createDesignator} onChange={(event) => setCreateDesignator(event.target.value.toUpperCase())} placeholder="SABAI3A" /></label>
            <label><span>ENTRY FIX</span><input value={createEntryFix} onChange={(event) => setCreateEntryFix(event.target.value.toUpperCase())} placeholder="SABAI" /></label>
            <label><span>EFFECTIVE FROM</span><input type="date" value={createEffective} onChange={(event) => setCreateEffective(event.target.value)} /></label>
            <label><span>RUNWAY APPLICABILITY</span><input value={createApplicability} onChange={(event) => setCreateApplicability(event.target.value)} placeholder="21L / 21R" /></label>
            <label><span>CHART REFERENCE</span><input value={createChart} onChange={(event) => setCreateChart(event.target.value)} placeholder="AD 2-VTBD-7-1" /></label>
            <label className="star-create-source"><span>SOURCE</span><input value={createSource} onChange={(event) => setCreateSource(event.target.value)} placeholder="AIP Thailand ..." /></label>
          </div>
          <div className="star-create-actions"><button onClick={resetCreate} disabled={saving}>Cancel</button><button className="primary-admin-action" onClick={() => void createStar()} disabled={saving}>{saving ? 'Saving…' : 'Create STAR'}</button></div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table star-edit-table">
          <thead><tr><th>STAR</th><th>ENTRY FIX</th><th>APPLICABILITY</th><th>CHART</th><th>EFFECTIVE</th><th>SOURCE</th><th>STATUS</th><th /></tr></thead>
          <tbody>
            {visibleStars.length === 0 ? <tr><td colSpan={8} className="admin-empty-cell">No STAR records for this runway configuration. This is valid.</td></tr> : visibleStars.map((star) => {
              const draft = drafts[star.id]
              if (!draft) return null
              const isChanged = changed(star)
              return <tr key={star.id} className={!draft.active ? 'star-row-inactive' : ''}>
                <td><input className="star-code-input" value={draft.designator} onChange={(event) => updateDraft(star.id, { designator: event.target.value.toUpperCase() })} /></td>
                <td><input className="star-fix-input" value={draft.entryFix} onChange={(event) => updateDraft(star.id, { entryFix: event.target.value.toUpperCase() })} /></td>
                <td><input value={draft.runwayApplicability} onChange={(event) => updateDraft(star.id, { runwayApplicability: event.target.value })} /></td>
                <td><input value={draft.chartReference} onChange={(event) => updateDraft(star.id, { chartReference: event.target.value })} /></td>
                <td><div className="star-date-stack"><input type="date" value={draft.effectiveFrom} onChange={(event) => updateDraft(star.id, { effectiveFrom: event.target.value })} /><input type="date" value={draft.effectiveTo} onChange={(event) => updateDraft(star.id, { effectiveTo: event.target.value })} /></div></td>
                <td><input className="star-source-input" value={draft.source} onChange={(event) => updateDraft(star.id, { source: event.target.value })} /></td>
                <td><label className="admin-check"><input type="checkbox" checked={draft.active} onChange={(event) => updateDraft(star.id, { active: event.target.checked })} /><span>{draft.active ? 'ACTIVE' : 'ARCHIVED'}</span></label></td>
                <td><button className={isChanged ? 'timing-save changed' : 'timing-save'} disabled={saving || !isChanged} onClick={() => void saveStar(star)}>{saving && isChanged ? 'Saving…' : 'Save'}</button></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="timing-note">STAR data is optional. Do not create synthetic procedures for airports without a published STAR.</div>
    </section>
  )
}
