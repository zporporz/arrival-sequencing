type Airport = {
  id: string
  icao: string
  name: string
  city: string | null
  fir: string
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
  sort_order: number
}

type Props = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  selectedAirportId: string
  onAirportChange: (id: string) => void
  saving: boolean
  act: (body: Record<string, unknown>) => Promise<void>
}

function state(active: boolean, published: boolean) {
  if (!active) return { label: 'ARCHIVED', className: 'archived' }
  if (published) return { label: 'PUBLISHED', className: 'published' }
  return { label: 'NOT PUBLISHED', className: 'draft' }
}

export default function AirportEditor({ airports, runwayConfigs, selectedAirportId, onAirportChange, saving, act }: Props) {
  const airport = airports.find((item) => item.id === selectedAirportId) ?? null
  const runways = runwayConfigs.filter((item) => item.airport_id === selectedAirportId)

  return (
    <section className="admin-grid">
      <div className="admin-card airport-list-card">
        <div className="admin-card-heading">
          <div><span className="admin-label">AIRPORTS</span><h2>Bangkok FIR workspaces</h2></div>
          <button disabled={saving} onClick={() => {
            const icao = window.prompt('ICAO code (4 letters)')?.trim().toUpperCase()
            if (!icao) return
            const name = window.prompt('Airport name')?.trim()
            if (!name) return
            void act({ action: 'airport.create', icao, name, fir: 'BANGKOK', published: false })
          }}>+ Add airport</button>
        </div>
        <div className="admin-airport-list">
          {airports.map((item) => {
            const s = state(item.active, item.published)
            return <button key={item.id} className={`admin-airport-row ${selectedAirportId === item.id ? 'selected' : ''}`} onClick={() => onAirportChange(item.id)}>
              <span className="airport-code">{item.icao}</span>
              <span className="airport-copy"><strong>{item.name}</strong><small>{item.city || '—'} · {item.fir} FIR</small></span>
              <span className={`admin-state ${s.className}`}>{s.label}</span>
            </button>
          })}
        </div>
      </div>

      <div className="admin-card airport-detail-card">
        {!airport ? <div className="admin-empty">Select an airport.</div> : <>
          <div className="admin-card-heading">
            <div><span className="admin-label">{airport.icao}</span><h2>{airport.name}</h2><p>{airport.city || 'No city set'} · {airport.fir} FIR</p></div>
            <div className="admin-publish-actions">
              {airport.active && <button className={airport.published ? 'unpublish-soft' : 'publish-soft'} disabled={saving} onClick={() => void act({ action: 'airport.update', id: airport.id, published: !airport.published })}>{airport.published ? 'Unpublish' : 'Publish'}</button>}
              <button className={airport.active ? 'danger-soft' : 'restore-soft'} disabled={saving} onClick={() => void act({ action: 'airport.update', id: airport.id, active: !airport.active })}>{airport.active ? 'Archive airport' : 'Restore airport'}</button>
            </div>
          </div>

          <div className="admin-section-title">
            <div><span className="admin-label">RUNWAY CONFIGURATIONS</span><h3>{runways.length} configured</h3></div>
            <button disabled={saving} onClick={() => {
              const flow = window.prompt('Flow key (example: 21, 03, 01_02)')?.trim()
              if (!flow) return
              const label = window.prompt('Runway label (example: 21L / 21R)')?.trim()
              if (!label) return
              void act({ action: 'runway.create', airportId: airport.id, flow, label, timingStatus: 'PENDING', published: false, sortOrder: runways.length * 10 + 10 })
            }}>+ Add configuration</button>
          </div>

          <div className="runway-config-list">
            {runways.length === 0 ? <div className="admin-empty">No runway configurations. Add one to create a sequencing workspace.</div> : runways.map((runway) => {
              const s = state(runway.active, runway.published)
              return <div className="runway-config-row" key={runway.id}>
                <div><strong>{runway.label}</strong><small>flow: {runway.flow} · <span className={`inline-publish-state ${s.className}`}>{s.label}</span></small></div>
                <select value={runway.timing_status} disabled={saving} onChange={(event) => void act({ action: 'runway.update', id: runway.id, timingStatus: event.target.value })}>
                  <option value="ACTIVE">TIMING ACTIVE</option>
                  <option value="PENDING">TIMING PENDING</option>
                  <option value="DISABLED">TIMING DISABLED</option>
                </select>
                <div className="runway-actions">
                  {runway.active && <button className={runway.published ? 'unpublish-link' : 'publish-link'} disabled={saving} onClick={() => void act({ action: 'runway.update', id: runway.id, published: !runway.published })}>{runway.published ? 'Unpublish' : 'Publish'}</button>}
                  <button className={runway.active ? 'danger-link' : 'restore-link'} disabled={saving} onClick={() => void act({ action: 'runway.update', id: runway.id, active: !runway.active })}>{runway.active ? 'Archive' : 'Restore'}</button>
                </div>
              </div>
            })}
          </div>
        </>}
      </div>
    </section>
  )
}
