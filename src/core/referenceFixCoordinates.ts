export type ReferenceFixCoordinate = { lat: number; lon: number }

function dms(degrees: number, minutes: number, seconds: number) {
  return degrees + minutes / 60 + seconds / 3600
}

// CAAT Thailand eAIP VTBD/VTBS STAR waypoint lists (WGS-84). These coordinates
// provide a last-resort position ETA for a pilot whose IVAO session begins in
// the air and whose filed route cannot be parsed. Normal route geometry remains
// the preferred source.
const REFERENCE_FIX_COORDINATES: Record<string, ReferenceFixCoordinate> = {
  ENDUU: { lat: dms(14, 29, 49.38), lon: dms(101, 13, 16.75) },
  NAKON: { lat: dms(14, 42, 13.90), lon: dms(100, 31, 3.39) },
  SABAI: { lat: dms(13, 7, 22.13), lon: dms(100, 19, 39.23) },
  SEHNA: { lat: dms(13, 17, 42.18), lon: dms(101, 10, 42.55) },
  WEHHA: { lat: dms(14, 15, 55.67), lon: dms(100, 3, 33.01) },
  EASTE: { lat: dms(14, 18, 34.80), lon: dms(101, 17, 10.48) },
  LEBIM: { lat: dms(13, 5, 14.81), lon: dms(100, 28, 24.51) },
  NORTA: { lat: dms(14, 43, 7.64), lon: dms(100, 38, 20.46) },
  TUMGA: { lat: dms(13, 21, 15.01), lon: dms(101, 12, 3.77) },
  WILLA: { lat: dms(14, 24, 16.98), lon: dms(100, 3, 35.36) },
}

export function referenceFixCoordinate(fix: string) {
  return REFERENCE_FIX_COORDINATES[fix.trim().toUpperCase()] ?? null
}
