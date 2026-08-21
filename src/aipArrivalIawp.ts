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

// Some filed routes already contain the IAWP itself followed by the STAR
// designator, e.g. "DCT SEHNA SEHNA3A". The old resolver only understood the
// upstream transition mapping and therefore dropped otherwise valid traffic.
// Known procedure stems are only used after exact IAWP matching.
const STAR_STEM_TO_IAWP: Record<string, Record<string, string>> = {
  VTBD: {
    WEHA: 'WEHHA',
    NAKO: 'NAKON',
    ENDU: 'ENDUU',
    SEHN: 'SEHNA',
    SABA: 'SABAI',
  },
  VTBS: {},
}

function directOrStarIawp(
  airport: string,
  token: string,
  allowed: Set<string>,
) {
  if (allowed.has(token)) return token

  const procedureStem = token.match(/^([A-Z]{2,6})\d[A-Z]$/)?.[1]
  if (!procedureStem) return null

  const explicit = STAR_STEM_TO_IAWP[airport]?.[procedureStem]
  if (explicit && allowed.has(explicit)) return explicit

  const candidates = [...allowed].filter((fix) => fix === procedureStem || fix.startsWith(procedureStem))
  return candidates.length === 1 ? candidates[0] : null
}

export function findAipIawp(
  airport: string,
  route: string | null,
  allowedEntryFixes: string[],
): AipIawpMatch | null {
  if (!route) return null
  const normalizedAirport = airport.trim().toUpperCase()
  const airportMap = TRANSITION_TO_IAWP[normalizedAirport]
  if (!airportMap) return null

  const allowed = new Set(allowedEntryFixes.map((fix) => fix.trim().toUpperCase()).filter(Boolean))
  if (!allowed.size) return null

  const tokens = route.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const via = tokens[index]

    // Prefer an IAWP or STAR explicitly filed near the end of the route. This is the
    // correct result for routes such as DCT SEHNA SEHNA3A and still preserves the
    // existing transition mapping for normal en-route filings.
    const direct = directOrStarIawp(normalizedAirport, via, allowed)
    if (direct) {
      return { via, entryFix: direct, source: 'FILED ROUTE IAWP / STAR' }
    }

    const entryFix = airportMap[via]
    if (!entryFix || !allowed.has(entryFix)) continue
    return { via, entryFix, source: AIP_IAWP_SOURCE }
  }

  return null
}
