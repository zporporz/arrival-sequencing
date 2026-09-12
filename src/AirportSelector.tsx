import { AIRPORT_NAMES, AMAN_AIRPORTS, changeAirportView, type AirportView, type AirportCode } from './core/airports'

export default function AirportSelector({ view, onChange }: { view: AirportView; onChange: (view: AirportView) => void }) {
  return <div className="aman-airport-tabs aman-native-airport-picker">
    <div className="aman-airport-scope-picker">
      <span className="aman-selector-heading">AIRPORT VIEW</span>
      {(['LEFT', 'RIGHT'] as const).map(side => <label className="aman-side-select" key={side}>
        <span>{side}</span>
        <select aria-label={`${side} airport`} value={view[side]} onChange={event => onChange(changeAirportView(view, side, event.target.value as AirportCode | ''))}>
          <option value="">— Off —</option>
          {AMAN_AIRPORTS.map(code => <option key={code} value={code}>{code} · {AIRPORT_NAMES[code]}</option>)}
        </select>
      </label>)}
      {/* Read-only compatibility surface for operational runtimes. React owns selection. */}
      <div hidden aria-hidden="true">{(['LEFT', 'RIGHT'] as const).filter(side => view[side]).map(side =>
        <input key={side} type="checkbox" readOnly checked value={view[side]} data-side={side} tabIndex={-1} />)}</div>
    </div>
  </div>
}
