export type VtbsFlow = '19_20' | '01_02'
export type RunwayMode = 'ARR' | 'DEP' | 'MIX' | 'CLOSED'
export declare const VTBS_RUNWAY_GROUPS: Record<VtbsFlow, readonly string[]>
export declare const VTBS_ALL_RUNWAYS: readonly string[]
export declare function vtbsFlowFromWorkspace(modes?: Record<string, string>, settings?: Record<string, unknown>): VtbsFlow
export declare function vtbsModesForFlow(modes: Record<string, string>, flow: VtbsFlow): Record<string, RunwayMode>
