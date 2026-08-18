export const VTBS_STAR19_NOMINAL_MINUTES = {
  LEBIM: 21,
  DOLNI: 20,
  EASTE: 19,
  WILLA: 21,
  NORTA: 20,
} as const

export const VTBS_STAR01_NOMINAL_MINUTES = {
  LEBIM: 20,
  DOLNI: 17,
  EASTE: 19,
  WILLA: 24,
  NORTA: 22,
} as const

// Current working arrival group: RWY 19 / 20L / 20R use the same STAR19 timing set.
export const VTBS_IAWP_NOMINAL_MINUTES = VTBS_STAR19_NOMINAL_MINUTES

export const VTBS_SHORTCUT_REDUCTION_AT_LEAST_MINUTES = {
  STAR19: 5,
  STAR01: 2,
} as const

export const VTBD_IAWP_NOMINAL_MINUTES = {
  NAKON: 13,
  WEHHA: 13,
  ENDUU: 17,
  SABAI: 20,
  SEHNA: 25,
  HOTEL: 21,
  TL: 18,
  UBLOD: 19,
  NODEG: 13,
  OPERA: 13,
} as const

// VTBD compact IAWP codes use the first letter. SABAI and SEHNA both start with S,
// so the rebuild distinguishes them visually: SABAI = uppercase S, SEHNA = lowercase underlined s.
// Keep the underline as presentation metadata rather than a combining Unicode character.
export const VTBD_IAWP_COMPACT_CODES = {
  ENDUU: 'E',
  NAKON: 'N',
  SABAI: 'S',
  SEHNA: 's',
  WEHHA: 'W',
} as const

export const VTBD_IAWP_COMPACT_CODE_STYLE = {
  ENDUU: 'NORMAL',
  NAKON: 'NORMAL',
  SABAI: 'NORMAL',
  SEHNA: 'UNDERLINE',
  WEHHA: 'NORMAL',
} as const

export const VTBD_SHORTCUT_REDUCTION_MINUTES = {
  ENDUU_TO_OPERA: 4,
  SABAI_TO_NODEG: 7,
  SEHNA_TO_NODEG: 12,
} as const

export const AMAN_REFERENCE_SPEED_KT = 140
export const AMAN_NORMAL_GAP_NM = 5
export const AMAN_TLDT_GAP_MINUTES = 2.14

export const AMAN_DEFAULT_RUNWAY_SPACING_NM = {
  VTBD: {
    '21R': 5,
    '21L': 7.1,
  },
  VTBS: {
    '19': 5.5,
    '20L': 8,
    '20R': 6,
  },
} as const

export const AMAN_SPECIAL_SEPARATION_MINUTES = {
  ATR: 4,
  A380: 3,
} as const

export const AMAN_SPECIAL_SEPARATION_NM = {
  ATR_APPROX: 10,
  A380: 7,
} as const

export const nmToMinutesAtReferenceSpeed = (distanceNm: number) =>
  distanceNm / AMAN_REFERENCE_SPEED_KT * 60

export const AMAN_DEFAULT_RUNWAY_SPACING_MINUTES = {
  VTBD: {
    '21R': nmToMinutesAtReferenceSpeed(AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21R']),
    '21L': nmToMinutesAtReferenceSpeed(AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBD['21L']),
  },
  VTBS: {
    '19': nmToMinutesAtReferenceSpeed(AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['19']),
    '20L': nmToMinutesAtReferenceSpeed(AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20L']),
    '20R': nmToMinutesAtReferenceSpeed(AMAN_DEFAULT_RUNWAY_SPACING_NM.VTBS['20R']),
  },
} as const

// Working Thailand delay-colour thresholds. Keep centralised so they can be changed later.
export const AMAN_DELAY_THRESHOLDS_MINUTES = {
  NOTHING: 0,
  SPEED_REDUCTION_MAX: 2,
  PATH_STRETCHING_MAX: 4,
  HOLDING_MIN: 5,
} as const

export type AmanDelayAction = 'EXPEDITE' | 'NOTHING' | 'SPEED_REDUCTION' | 'PATH_STRETCHING' | 'HOLDING'

export const classifyAmanDelay = (delayMinutes: number): AmanDelayAction => {
  if (delayMinutes < 0) return 'EXPEDITE'
  if (delayMinutes === 0) return 'NOTHING'
  if (delayMinutes <= AMAN_DELAY_THRESHOLDS_MINUTES.SPEED_REDUCTION_MAX) return 'SPEED_REDUCTION'
  if (delayMinutes <= AMAN_DELAY_THRESHOLDS_MINUTES.PATH_STRETCHING_MAX) return 'PATH_STRETCHING'
  return 'HOLDING'
}

// Thailand SME: holding is applied at the head of the STAR / feeder-entry point.
export const AMAN_HOLDING_POINT_MODEL = 'STAR_ENTRY' as const

// MAESTRO timeline display model.
// The current-time line stays fixed while the time scale and flight labels move downward as UTC advances.
export const AMAN_TIMELINE_MAJOR_TICK_MINUTES = 5
export const AMAN_TIMELINE_MINOR_TICK_MINUTES = 1

// Flights whose target/landing time has passed the fixed current-time line are treated as landed for display.
// Keep them visible below the line for a selectable history window.
export const AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES = [5, 10, 15, 20] as const
export const AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES = 10

export type VtbsIawpWithNominalTime = keyof typeof VTBS_STAR19_NOMINAL_MINUTES
