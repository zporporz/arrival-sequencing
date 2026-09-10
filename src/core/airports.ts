export const AMAN_AIRPORTS = ['VTBD', 'VTBS', 'VTCC', 'VTSP'] as const
export type AirportCode = typeof AMAN_AIRPORTS[number]
export type DisplaySide = 'LEFT' | 'RIGHT'
export type AirportView = Record<DisplaySide, AirportCode | ''>
export const AIRPORT_NAMES: Record<AirportCode, string> = {
  VTBD: 'Don Mueang', VTBS: 'Suvarnabhumi', VTCC: 'Chiang Mai', VTSP: 'Phuket',
}
export const DEFAULT_AIRPORT_VIEW: AirportView = { LEFT: 'VTBS', RIGHT: 'VTBD' }
export const REGIONAL_APPROACH_DEFAULTS = {
  VTCC: { '18': 'R18', '36': 'I36-Z' }, VTSP: { '09': 'R09-Y', '27': 'I27' },
} as const
export const AIRPORT_REFERENCE: Record<AirportCode, {lat: number; lon: number}> = {
  VTBD: { lat: 13.9126, lon: 100.6068 }, VTBS: { lat: 13.6811, lon: 100.7473 },
  VTCC: { lat: 18.771389, lon: 98.962776 }, VTSP: { lat: 8.1125, lon: 98.309166 },
}
export function isAmanAirport(value: unknown): value is AirportCode {
  return AMAN_AIRPORTS.includes(value as AirportCode)
}
export function isRegionalAirport(value: unknown): value is 'VTCC' | 'VTSP' {
  return value === 'VTCC' || value === 'VTSP'
}
export function airportFromId(id: string): AirportCode {
  return id.toUpperCase().match(/(?:^|:)(VTBD|VTBS|VTCC|VTSP)(?=:|$)/)?.[1] as AirportCode || 'VTBD'
}
export function airportFromRow(row: HTMLElement): AirportCode | null {
  const code = row.dataset.airport || row.title.match(/\b(VTBD|VTBS|VTCC|VTSP)\b/)?.[1]
    || `VT${row.querySelector('.apt')?.textContent?.trim() || ''}`
  return isAmanAirport(code) ? code : null
}
export function runwayFromRow(row: HTMLElement): string {
  return row.querySelector<HTMLSelectElement>('.runway-assignment select')?.value
    || row.title.match(/\bRWY\s+([0-9]{2}[LRC]?)/)?.[1]
    || row.querySelector('.runway-assignment')?.textContent?.trim().replace(/^(?:BD|BS|CC|SP)\//, '') || ''
}
export function selectedAmanAirports(): AirportCode[] {
  const selected = Array.from(document.querySelectorAll<HTMLInputElement>('.aman-airport-scope-picker input:checked'))
    .map(input => input.value).filter(isAmanAirport)
  return selected.length ? selected : ['VTBS', 'VTBD']
}
export function displaySidesFromDom(): Record<AirportCode, DisplaySide> {
  const result: Record<AirportCode, DisplaySide> = { VTBS: 'LEFT', VTBD: 'RIGHT', VTCC: 'LEFT', VTSP: 'RIGHT' }
  document.querySelectorAll<HTMLInputElement>('.aman-airport-scope-picker input:checked').forEach(input => {
    if (isAmanAirport(input.value) && (input.dataset.side === 'LEFT' || input.dataset.side === 'RIGHT')) result[input.value] = input.dataset.side
  })
  return result
}
// A duplicate selection swaps sides; at least one airport always remains visible.
export function changeAirportView(view: AirportView, side: DisplaySide, value: AirportCode | ''): AirportView {
  const other = side === 'LEFT' ? 'RIGHT' : 'LEFT'
  if (!value && !view[other]) return view
  return { ...view, [side]: value, [other]: value && value === view[other] ? view[side] : view[other] }
}
