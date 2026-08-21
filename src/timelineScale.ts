// React's target/drag math remains on the historical 10 px/min logical scale.
// Render the controller timeline more densely so smaller displays can see a much
// larger time window without changing any sequencing, separation, or target math.
export const TIMELINE_LOGICAL_PX_PER_MINUTE = 10
export const TIMELINE_DISPLAY_PX_PER_MINUTE = 12
export const TIMELINE_DISPLAY_SCALE = TIMELINE_DISPLAY_PX_PER_MINUTE / TIMELINE_LOGICAL_PX_PER_MINUTE
