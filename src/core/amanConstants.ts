export const VTBS_IAWP_NOMINAL_MINUTES = {
  EASTE: 18,
  NORTA: 20,
  LEBIM: 18,
  TUMGA: 20,
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

export type VtbsIawpWithNominalTime = keyof typeof VTBS_IAWP_NOMINAL_MINUTES
