// React's target/drag math remains on the historical 10 px/min logical scale.
// Render the controller timeline at a denser 9 px/min display scale so smaller
// screens can see a wider time window without changing sequencing or separation math.
export const TIMELINE_LOGICAL_PX_PER_MINUTE = 10
export const TIMELINE_DISPLAY_PX_PER_MINUTE = 9
export const TIMELINE_DISPLAY_SCALE = TIMELINE_DISPLAY_PX_PER_MINUTE / TIMELINE_LOGICAL_PX_PER_MINUTE
