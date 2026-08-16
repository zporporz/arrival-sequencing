import { useMemo, useState } from 'react'

type ConfigHistory = {
  id: number
  entity_type: string
  entity_id: string
  action: string
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
  changed_by_vid: string | null
  changed_by_name: string | null
  changed_at: string
}

type Props = {
  history: ConfigHistory[]
  saving: boolean
  act: (body: Record<string, unknown>) => Promise<void>
  reload: () => Promise<void>
}

const hiddenFields = new Set([
  'id', 'created_at', 'updated_at', 'created_by_vid', 'created_by_name', 'updated_by_vid', 'updated_by_name', 'runway_config_id', 'airport_id',
])

function fmtTime(value: string) {
  return new Date(value).toLocaleString('en-GB', { hour12: false, timeZone: 'UTC' }) + ' UTC'
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'YES' : 'NO'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function changedFields(item: ConfigHistory) {
  const oldRow = item.old_row ?? {}
  const newRow = item.new_row ?? {}
  const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)])
  return [...keys]
    .filter((key) => !hiddenFields.has(key))
    .filter((key) => JSON.stringify(oldRow[key]) !== JSON.stringify(newRow[key]))
    .sort()
    .map((key) => ({ key, oldValue: oldRow[key], newValue: newRow[key] }))
}

function titleFor(item: ConfigHistory) {
  const snapshot = item.new_row || item.old_row || {}
  return String(snapshot.icao || snapshot.designator || snapshot.fix || snapshot.label || item.entity_id)
}

export default function HistoryPanel({ history, saving, act, reload }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const restoreTypes = useMemo(() => new Set(['AIRPORT', 'RUNWAY_CONFIG', 'STAR_PROCEDURE', 'FIX_TIMING']), [])

  return (
    <section className="admin-card wide-card history-panel">
      <div className="admin-card-heading">
        <div>
          <span className="admin-label">CONFIGURATION HISTORY</span>
          <h2>Revision trail</h2>
          <p>Append-only history. Expand a revision to review exactly what changed before restoring it.</p>
        </div>
        <button onClick={() => void reload()}>Refresh</button>
      </div>
      <div className="history-list">
        {history.length === 0 ? <div className="admin-empty">No configuration history yet.</div> : history.map((item) => {
          const fields = changedFields(item)
          const isExpanded = expanded === item.id
          const canRestore = Boolean(item.old_row) && restoreTypes.has(item.entity_type)
          return <article key={item.id} className={`history-row history-row-expandable ${isExpanded ? 'expanded' : ''}`}>
            <div className="history-marker" />
            <div className="history-main">
              <button className="history-toggle" onClick={() => setExpanded(isExpanded ? null : item.id)}>
                <span className="history-title">
                  <strong>{item.entity_type.replaceAll('_', ' ')}</strong>
                  <span>{titleFor(item)}</span>
                  <span className={`history-action ${item.action.toLowerCase()}`}>{item.action}</span>
                </span>
                <span className="history-meta">{item.changed_by_name || 'TH Staff'} · {item.changed_by_vid || '—'} · {fmtTime(item.changed_at)}</span>
                <span className="history-chevron">{isExpanded ? '▴' : '▾'}</span>
              </button>
              {isExpanded && (
                <div className="history-detail">
                  {fields.length === 0 ? <div className="history-no-diff">No field-level difference to display.</div> : fields.map((field) => (
                    <div className="history-diff-row" key={field.key}>
                      <strong>{field.key.replaceAll('_', ' ').toUpperCase()}</strong>
                      <span className="history-old">{displayValue(field.oldValue)}</span>
                      <span className="history-arrow">→</span>
                      <span className="history-new">{displayValue(field.newValue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="history-restore" disabled={!canRestore || saving} onClick={() => {
              if (window.confirm(`Restore the state before revision #${item.id}?`)) void act({ action: 'history.restore', historyId: item.id })
            }}>Restore previous</button>
          </article>
        })}
      </div>
    </section>
  )
}
