export const VTBS_IAWP_NOMINAL_MINUTES = {
  EASTE: 18,
  NORTA: 20,
  LEBIM: 18,
  TUMGA: 20,
} as const

export const AMAN_TLDT_GAP_MINUTES = 2.8
export const AMAN_REFERENCE_SPEED_KT = 140

export const AMAN_SPECIAL_SEPARATION_MINUTES = {
  ATR: 4,
  A380: 3,
} as const

export const AMAN_SPECIAL_SEPARATION_NM = {
  ATR_APPROX: 10,
  A380: 7,
} as const

export type VtbsIawpWithNominalTime = keyof typeof VTBS_IAWP_NOMINAL_MINUTES
