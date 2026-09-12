export type VtbsFlow = '19_20' | '01_02'
export type RunwayMode = 'ARR' | 'DEP' | 'MIX' | 'CLOSED'
export const VTBS_RUNWAY_GROUPS: Record<VtbsFlow, readonly string[]>
export const VTBS_ALL_RUNWAYS: readonly string[]
export function vtbsFlowFromWorkspace(modes?: Record<string, string>, settings?: Record<string, unknown>): VtbsFlow
export function vtbsModesForFlow(modes: Record<string, string>, flow: VtbsFlow): Record<string, RunwayMode>
