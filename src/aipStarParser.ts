export type ParsedAipStar = {
  airport: string
  runwayApplicability: string
  designator: string
  entryFix: string
  chartReference: string
  effectiveFrom: string | null
  sourceKind: string
  sourceLabel: string | null
  sourceUrl: string | null
  source?: string | null
}

export type AipIssueMetadata = {
  airac: string | null
  effectiveDate: string | null
  publicationDate: string | null
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

export function normalizeAipText(value: string) {
  return String(value || '')
    .replace(/[\u00ad\ufffe\uffff]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function aipDateToIso(value: string) {
  const match = normalizeAipText(value).toUpperCase().match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/)
  if (!match) return null
  return `${match[3]}-${MONTHS[match[2]]}-${String(Number(match[1])).padStart(2, '0')}`
}

export function normalizeRunwayLabel(value: string) {
  return normalizeAipText(value)
    .toUpperCase()
    .replace(/^RWY\s*/i, '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDesignators(value: string) {
  return [...new Set(normalizeAipText(value).toUpperCase().match(/\b[A-Z]{2,6}\d[A-Z]\b/g) || [])]
}

export function parseAipStarText(text: string, options: { sourceKind?: string; sourceLabel?: string | null; sourceUrl?: string | null } = {}): ParsedAipStar[] {
  const cleaned = normalizeAipText(text)
  const records: ParsedAipStar[] = []
  const seen = new Set<string>()
  const rowPattern = /\b(?:RNAV\s+)?RWY\s*([0-9]{2}[LRC]?(?:\s*\/\s*[0-9]{2}[LRC]?){0,3})\s*-\s*([\s\S]{1,700}?)\s+AD\s*2-(VT[A-Z0-9]{2})-7-(\d+)\b/gi

  for (const match of cleaned.matchAll(rowPattern)) {
    const runway = normalizeRunwayLabel(match[1])
    const airport = match[3].toUpperCase()
    const chartReference = `AD 2-${airport}-7-${match[4]}`
    const tail = cleaned.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 260)
    const effectiveFrom = aipDateToIso(tail)
    for (const designator of extractDesignators(match[2])) {
      const key = `${airport}|${runway}|${designator}|${chartReference}`
      if (seen.has(key)) continue
      seen.add(key)
      records.push({
        airport,
        runwayApplicability: runway,
        designator,
        entryFix: designator.replace(/\d[A-Z]$/, ''),
        chartReference,
        effectiveFrom,
        sourceKind: options.sourceKind || 'AIP',
        sourceLabel: options.sourceLabel || null,
        sourceUrl: options.sourceUrl || null,
      })
    }
  }
  return records
}

export function parseAipIssueMetadata(text: string): AipIssueMetadata {
  const cleaned = normalizeAipText(text)
  const airac = cleaned.match(/AIRAC\s+AIP\s+(?:AMDT|AMENDMENT)\s+(\d{1,2}\/\d{2})/i)?.[1] || null
  const effective = cleaned.match(/Effective\s+date\s*:?\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i)?.[1] || null
  const publication = cleaned.match(/Publication\s+date\s*:?\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i)?.[1] || null
  return {
    airac,
    effectiveDate: effective ? aipDateToIso(effective) : null,
    publicationDate: publication ? aipDateToIso(publication) : null,
  }
}
