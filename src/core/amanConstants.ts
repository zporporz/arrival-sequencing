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

// MAESTRO knowgood v2.4: the processing coverage is described as roughly 200-300 NM.
// The project uses the outer 300 NM edge as the active-processing admission boundary and
// keeps more distant destination traffic monitored in the Inbound panel.
export const AMAN_PROCESSING_RADIUS_BAND_NM = {
  MIN: 200,
  MAX: 300,
} as const
export const AMAN_PROCESSING_RADIUS_NM = AMAN_PROCESSING_RADIUS_BAND_NM.MAX

// MAESTRO knowgood v2.4: ETA-FF from TopSky is dynamically updated every 15 seconds.
export const AMAN_ETA_FF_REFRESH_SECONDS = 15
export const AMAN_ETA_FF_REFRESH_MS = AMAN_ETA_FF_REFRESH_SECONDS * 1000

// Delay Splitting shown in the Thai MAESTRO operational matrix keeps up to four minutes
// of positive delay in the Approach segment (ADLY); excess delay is allocated before
// the feeder fix (EDLY). The 6/2, 7/3, 8/4, >=9/>=5 matrix rows all imply ADLY = 4.
export const AMAN_APPROACH_DELAY_BUDGET_MINUTES = 4

export type AmanDelaySplit = {
  tdlyMinutes: number
  edlyMinutes: number
  adlyMinutes: number
  gainMinutes: number
}

export const splitAmanDelay = (delayMinutes: number): AmanDelaySplit => {
  if (!Number.isFinite(delayMinutes)) {
    return { tdlyMinutes: 0, edlyMinutes: 0, adlyMinutes: 0, gainMinutes: 0 }
  }
  if (delayMinutes < 0) {
    return { tdlyMinutes: delayMinutes, edlyMinutes: 0, adlyMinutes: 0, gainMinutes: Math.abs(delayMinutes) }
  }
  const adlyMinutes = Math.min(delayMinutes, AMAN_APPROACH_DELAY_BUDGET_MINUTES)
  return {
    tdlyMinutes: delayMinutes,
    edlyMinutes: Math.max(0, delayMinutes - adlyMinutes),
    adlyMinutes,
    gainMinutes: 0,
  }
}

export type AmanOperationalBand = 'GAIN' | 'NORMAL' | 'PERMIT_ENTRY' | 'ORBIT_PERMIT' | 'CONSIDER_HOLD' | 'OVERLOAD'

export type AmanOperationalMatrixAdvice = {
  band: AmanOperationalBand
  primary: string
  secondary: string
  vectorLimit: string
  shortLabel: string
}

// Thai MAESTRO knowgood v2.4 operational quick-reference matrix.
export const getAmanOperationalMatrixAdvice = (delayMinutes: number): AmanOperationalMatrixAdvice => {
  if (delayMinutes < 0) {
    return { band: 'GAIN', primary: 'Shortcut / speed up', secondary: 'Expedite', vectorLimit: '—', shortLabel: 'GAIN' }
  }
  if (delayMinutes >= 9) {
    return { band: 'OVERLOAD', primary: 'HOLD ALL', secondary: 'Issue EAT (STA-FF)', vectorLimit: 'OVERLOAD', shortLabel: 'HOLD ALL' }
  }
  if (delayMinutes >= 8) {
    return { band: 'CONSIDER_HOLD', primary: 'Consider Hold', secondary: 'Runway change', vectorLimit: 'MAX LIMIT', shortLabel: 'HOLD/RWY' }
  }
  if (delayMinutes >= 7) {
    return { band: 'ORBIT_PERMIT', primary: 'Orbit / Permit', secondary: 'Assess inner traffic', vectorLimit: '~30 NM', shortLabel: 'ORBIT' }
  }
  if (delayMinutes >= 6) {
    return { band: 'PERMIT_ENTRY', primary: 'Permit Entry', secondary: 'Reduce Speed', vectorLimit: '<25 NM', shortLabel: 'PERMIT' }
  }
  return { band: 'NORMAL', primary: delayMinutes === 0 ? 'Normal flight' : 'Delay absorption', secondary: 'Speed / path as required', vectorLimit: '—', shortLabel: delayMinutes === 0 ? 'NORMAL' : 'MANAGE' }
}

// Delay-colour presentation remains a project HMI mapping. The new knowgood moves automatic
// holding to the >=9-minute overload band; +8 is "Consider Hold" rather than HOLD ALL.
export const AMAN_DELAY_THRESHOLDS_MINUTES = {
  NOTHING: 0,
  SPEED_REDUCTION_MAX: 2,
  PATH_STRETCHING_MAX: 8,
  HOLDING_MIN: 9,
} as const

export type AmanDelayAction = 'EXPEDITE' | 'NOTHING' | 'SPEED_REDUCTION' | 'PATH_STRETCHING' | 'HOLDING'

export const classifyAmanDelay = (delayMinutes: number): AmanDelayAction => {
  if (delayMinutes < 0) return 'EXPEDITE'
  if (delayMinutes === 0) return 'NOTHING'
  if (delayMinutes <= AMAN_DELAY_THRESHOLDS_MINUTES.SPEED_REDUCTION_MAX) return 'SPEED_REDUCTION'
  if (delayMinutes <= AMAN_DELAY_THRESHOLDS_MINUTES.PATH_STRETCHING_MAX) return 'PATH_STRETCHING'
  return 'HOLDING'
}

// Thailand SME / MAESTRO working model: holding is applied at the STAR / feeder entry.
export const AMAN_HOLDING_POINT_MODEL = 'STAR_ENTRY' as const

// VTBS Airport Capacity Heatmap in the new MAESTRO knowgood shows ARR 37 MAX.
// No equivalent authoritative VTBD maximum is provided by that deck, so VTBD continues
// to use the configured runway-spacing capacity estimate in the HMI.
export const AMAN_REFERENCE_AAR_PER_HOUR = {
  VTBS: 37,
} as const

// Bangkok TMA counter working model: 50 NM radius from BKK DVOR/DME.
// BKK coordinates from Thailand AIP ENR 4.1: 13°53'36.8"N 100°35'46.3"E.
export const BKK_VOR_COORDINATES = {
  lat: 13.8935556,
  lon: 100.5961944,
} as const
export const BANGKOK_TMA_WORKING_RADIUS_NM = 50

// MAESTRO timeline display model.
// The current-time line stays fixed while the time scale and flight labels move downward as UTC advances.
export const AMAN_TIMELINE_MAJOR_TICK_MINUTES = 5
export const AMAN_TIMELINE_MINOR_TICK_MINUTES = 1

// Flights whose target/landing time has passed the fixed current-time line are treated as landed for display.
// Keep them visible below the line for a selectable history window.
export const AMAN_POST_CURRENT_LINE_RETENTION_OPTIONS_MINUTES = [5, 10, 15, 20] as const
export const AMAN_POST_CURRENT_LINE_RETENTION_DEFAULT_MINUTES = 10

export type VtbsIawpWithNominalTime = keyof typeof VTBS_STAR19_NOMINAL_MINUTES
