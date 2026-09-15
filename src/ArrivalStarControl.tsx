import type { ArrivalStarSelection } from '../shared/arrivalStarSelection'
import './arrivalStarControl.css'

export default function ArrivalStarControl({ callsign, selection, onChange }: {
  callsign: string; selection?: ArrivalStarSelection | null; onChange: (name: string) => void
}) {
  if (!selection) return null
  return <label className="aman-star-choice" title={`${selection.reason} · This tab only; does not change FPL or ATC clearance`}>
    <small>{selection.filed ? 'FPL / RWY MISMATCH · ' : ''}{selection.status === 'REQUIRED' ? 'SELECT STAR' : 'STAR EST'}</small>
    {selection.candidates.length > 0 ? <select aria-label={`Planning STAR for ${callsign}`} value={selection.status === 'MANUAL_ESTIMATE' ? selection.selected || '' : ''}
      onChange={e => onChange(e.target.value)}>
      <option value="">{selection.status === 'ESTIMATED' ? `${selection.selected} · AUTO EST` : 'Choose STAR · local EST'}</option>
      {selection.candidates.map(name => <option key={name} value={name}>{name} · LOCAL EST</option>)}
    </select> : <small>No compatible STAR verified</small>}
    <small>RWY {selection.runway} · NOT A CLEARANCE</small>
  </label>
}
