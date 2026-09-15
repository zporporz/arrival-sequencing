import type { ArrivalStarSelection } from '../../shared/arrivalStarSelection'
import type { IvaoArrivalTrafficFlight } from './api'

type FlightScope = Pick<IvaoArrivalTrafficFlight, 'sessionId' | 'departure' | 'arrival' | 'route'>
const choices = new Map<string, string>()
const key = (flight: FlightScope, selection: ArrivalStarSelection) => JSON.stringify([
  flight.sessionId, flight.departure, flight.arrival, flight.route, selection.cycle,
  selection.airport, selection.runway, selection.entryFix, selection.filed,
])

// Test-site planning only: no FPL, shared clearance, database or target mutation.
// A change of session, route, AIRAC, runway or entry invalidates the old choice.
export function rememberArrivalStar(flight: FlightScope, selection: ArrivalStarSelection, name: string) {
  if (!name) { choices.delete(key(flight, selection)); return }
  if (!selection.candidates.includes(name)) return
  if (choices.size >= 300) choices.delete(choices.keys().next().value!)
  choices.set(key(flight, selection), name)
}
export function clearArrivalStarChoices() { choices.clear() }
export function applyArrivalStarChoice(flight: FlightScope, selection?: ArrivalStarSelection | null): ArrivalStarSelection | null {
  if (!selection) return null
  const selected = choices.get(key(flight, selection))
  if (!selected || !selection.candidates.includes(selected)) return selection
  return { ...selection, selected, status: 'MANUAL_ESTIMATE',
    reason: `${selection.filed ? `FPL STAR ${selection.filed} / RWY ${selection.runway} MISMATCH · ` : ''}STAR EST ${selected} · LOCAL USER CHOICE · NOT A CLEARANCE` }
}
