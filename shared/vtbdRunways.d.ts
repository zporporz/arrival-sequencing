export type VtbdFlow = '21' | '03'
type RunwayMode = 'ARR' | 'DEP' | 'MIX' | 'CLOSED'
export declare const VTBD_RUNWAY_GROUPS: Record<VtbdFlow, readonly string[]>
export declare const VTBD_ALL_RUNWAYS: readonly string[]
export declare function vtbdFlowFromWorkspace(modes?: Record<string, string>, settings?: Record<string, unknown>): VtbdFlow
export declare function vtbdModesForFlow(modes: Record<string, string>, flow: VtbdFlow): Record<string, RunwayMode>
