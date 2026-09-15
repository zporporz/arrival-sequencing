export type ArrivalStarCandidate = { name: string; airport: string; entryFix: string; runways: string[] }
export type ArrivalStarSelection = {
  status: 'ESTIMATED' | 'MANUAL_ESTIMATE' | 'REQUIRED'; airport: string; runway: string; entryFix: string;
  filed: string | null; selected: string | null; cycle?: string; candidates: string[]; reason: string
}
export function supportsArrivalRunway(published: string, selected: string): boolean
export function chooseArrivalStar(options: { airport: string; runway: string; entryFix: string; filed?: string | null;
  candidates: ArrivalStarCandidate[]; selected?: string; cycle?: string }): ArrivalStarSelection
