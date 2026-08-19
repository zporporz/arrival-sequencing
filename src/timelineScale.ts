// React's existing target/drag math was built around a 10 px/min logical scale.
// Keep that internal coordinate stable, but render the scrollable MAESTRO timeline
// at a larger 20 px/min display scale now that the 4-hour horizon can scroll.
export const TIMELINE_LOGICAL_PX_PER_MINUTE = 10
export const TIMELINE_DISPLAY_PX_PER_MINUTE = 20
export const TIMELINE_DISPLAY_SCALE = TIMELINE_DISPLAY_PX_PER_MINUTE / TIMELINE_LOGICAL_PX_PER_MINUTE
