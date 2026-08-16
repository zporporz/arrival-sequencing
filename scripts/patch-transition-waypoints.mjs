import fs from 'node:fs'

const apiPath = 'functions/api/admin/aip-import.js'
let api = fs.readFileSync(apiPath, 'utf8')

const marker = `async function issueContext(request) {`
const helper = `function extractTransitionWaypoints(html) {
  const fixes = new Set();
  const ignored = new Set(['INBOUND', 'ROUTES', 'ROUTE', 'TRANSITION', 'WAYPOINT', 'STAR', 'VTBS', 'RWY', 'NIL']);

  for (const tableMatch of html.matchAll(/<table\\b[\\s\\S]*?<\\/table>/gi)) {
    const tableHtml = tableMatch[0];
    const tableText = normalizeAipText(tableHtml).toUpperCase();
    if (!tableText.includes('INBOUND ROUTES') || !tableText.includes('TRANSITION WAYPOINT') || !tableText.includes('STAR')) continue;

    for (const rowMatch of tableHtml.matchAll(/<tr\\b[\\s\\S]*?<\\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<(?:td|th)\\b[^>]*>([\\s\\S]*?)<\\/(?:td|th)>/gi)]
        .map((match) => normalizeAipText(match[1]).toUpperCase())
        .filter(Boolean);
      if (cells.length < 2) continue;
      const waypointCell = cells[1];
      if (waypointCell.includes('TRANSITION WAYPOINT')) continue;
      for (const token of waypointCell.match(/\\b[A-Z][A-Z0-9]{1,7}\\b/g) || []) {
        if (ignored.has(token)) continue;
        if (/^\\d+$/.test(token)) continue;
        fixes.add(token);
      }
    }
  }

  return [...fixes].sort();
}

`
if (!api.includes(marker)) throw new Error('API marker not found')
if (!api.includes('function extractTransitionWaypoints')) api = api.replace(marker, helper + marker)

const oldReturn = `  const tables = extractWaypointTables(html, aerodromeUrl, airport);\n  return { issue: { ...issue, sourceUrl: aerodromeUrl }, airport, tables };`
const newReturn = `  const tables = extractWaypointTables(html, aerodromeUrl, airport);\n  const transitionWaypoints = extractTransitionWaypoints(html);\n  return { issue: { ...issue, sourceUrl: aerodromeUrl }, airport, tables, transitionWaypoints };`
if (!api.includes(oldReturn)) throw new Error('API return target not found')
api = api.replace(oldReturn, newReturn)
fs.writeFileSync(apiPath, api)

const uiPath = 'src/TimingEditor.tsx'
let ui = fs.readFileSync(uiPath, 'utf8')

const oldPayload = `      const tablePayload = await tableResponse.json() as { tables?: WaypointTable[]; error?: string }`
const newPayload = `      const tablePayload = await tableResponse.json() as { tables?: WaypointTable[]; transitionWaypoints?: string[]; error?: string }`
if (!ui.includes(oldPayload)) throw new Error('UI payload target not found')
ui = ui.replace(oldPayload, newPayload)

const oldBlock = `      const matchingTables = (tablePayload.tables || []).filter((table) => normalizeRunway(table.runwayApplicability) === normalizeRunway(runway.label))\n      if (!matchingTables.length) {\n        syncEntryFixes()\n        setAipWaypointMessage(\`CAAT waypoint list table was not found for \${airport.icao} \${runway.label}; STAR entry fixes were loaded instead.\`)\n        return\n      }\n\n      const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))\n      const next = new Map<string, StarTimingDraft>()\n      for (const suggestion of starFixSuggestions) next.set(suggestion.fix, { ...suggestion, designators: [...suggestion.designators] })`
const newBlock = `      const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))\n      const transitionWaypoints = (tablePayload.transitionWaypoints || []).map((fix) => fix.toUpperCase()).filter((fix) => !existingFixes.has(fix))\n      if (transitionWaypoints.length) {\n        const next = new Map<string, StarTimingDraft>()\n        for (const fix of transitionWaypoints) {\n          next.set(fix, {\n            fix,\n            minutes: '',\n            source: '',\n            effectiveFrom: defaultEffectiveFrom,\n            designators: [],\n            origin: 'AIP transition waypoint · AD 2.22 inbound routes',\n          })\n        }\n        const sorted = [...next.values()].sort((left, right) => left.fix.localeCompare(right.fix))\n        setStarDrafts(Object.fromEntries(sorted.map((draft) => [draft.fix, draft])))\n        setAipWaypointMessage(\`\${sorted.length} transition REF FIX candidates loaded from CAAT AD 2.22. Nominal Min is still required.\`)\n        return\n      }\n\n      const matchingTables = (tablePayload.tables || []).filter((table) => normalizeRunway(table.runwayApplicability) === normalizeRunway(runway.label))\n      if (!matchingTables.length) {\n        syncEntryFixes()\n        setAipWaypointMessage(\`CAAT transition-waypoint / waypoint-list data was not found for \${airport.icao} \${runway.label}; STAR entry fixes were loaded instead.\`)\n        return\n      }\n\n      const next = new Map<string, StarTimingDraft>()\n      for (const suggestion of starFixSuggestions) next.set(suggestion.fix, { ...suggestion, designators: [...suggestion.designators] })`
if (!ui.includes(oldBlock)) throw new Error('UI loader target not found')
ui = ui.replace(oldBlock, newBlock)
fs.writeFileSync(uiPath, ui)
