export type AipIawpMatch = {
  via: string
  entryFix: string
  source: string
}

export const AIP_IAWP_SOURCE = 'CAAT AIP ENR 1.10 §4.3 · AIRAC 2026-07-09'

// CAAT AIP ENR 1.10 §4.3 flight-planning transition -> IAWP mappings.
// These are airport-specific because the same inbound transition can feed a
// different IAWP at VTBD and VTBS.
const TRANSITION_TO_IAWP: Record<string, Record<string, string>> = {
  VTBD: {
    IBETO: 'WEHHA',
    TARED: 'WEHHA',
    IGONI: 'WEHHA',
    SEMBO: 'NAKON',
    BLAFF: 'NAKON',
    NOBER: 'NAKON',
    ALBOS: 'NAKON',
    UBLOD: 'ENDUU',
    ANREN: 'SEHNA',
    DULEM: 'SEHNA',
    GOMES: 'SEHNA',
    NUGPA: 'SEHNA',
    RYN: 'SEHNA',
    ALEMI: 'SEHNA',
    HOTEL: 'SABAI',
    GUTSO: 'SABAI',
    BUT: 'SABAI',
  },
  VTBS: {
    IBETO: 'WILLA',
    TARED: 'WILLA',
    IGONI: 'WILLA',
    SEMBO: 'NORTA',
    BLAFF: 'NORTA',
    NOBER: 'NORTA',
    ALBOS: 'NORTA',
    UBLOD: 'EASTE',
    RUKSA: 'EASTE',
    ANREN: 'TUMGA',
    DULEM: 'TUMGA',
    GOMES: 'TUMGA',
    NUGPA: 'TUMGA',
    RYN: 'TUMGA',
    ALEMI: 'TUMGA',
    HOTEL: 'LEBIM',
    GUTSO: 'LEBIM',
    BUT: 'TUMGA',
  },
}

export function findAipIawp(
  airport: string,
  route: string | null,
  allowedEntryFixes: string[],
): AipIawpMatch | null {
  if (!route) return null
  const airportMap = TRANSITION_TO_IAWP[airport.trim().toUpperCase()]
  if (!airportMap) return null

  const allowed = new Set(allowedEntryFixes.map((fix) => fix.trim().toUpperCase()).filter(Boolean))
  if (!allowed.size) return null

  const tokens = route.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const via = tokens[index]
    const entryFix = airportMap[via]
    if (!entryFix || !allowed.has(entryFix)) continue
    return { via, entryFix, source: AIP_IAWP_SOURCE }
  }

  return null
}
