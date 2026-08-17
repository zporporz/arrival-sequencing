const fs = require('fs');

function replace(path, from, to) {
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0,160)}`);
  s = s.replace(from, to);
  fs.writeFileSync(path, s);
}

replace(
  'functions/api/workspaces.js',
  `    const runwayConfigs = await supabaseAdminRequest(\n      context.env,\n      \"runway_configs?select=id,airport_id,flow,label,timing_status,active,published,sort_order&active=eq.true&published=eq.true&order=sort_order.asc,flow.asc\",\n    );\n\n    return Response.json({\n      airports: airports.data ?? [],\n      runwayConfigs: runwayConfigs.data ?? [],\n    }, {`,
  `    const runwayConfigs = await supabaseAdminRequest(\n      context.env,\n      \"runway_configs?select=id,airport_id,flow,label,timing_status,active,published,sort_order&active=eq.true&published=eq.true&order=sort_order.asc,flow.asc\",\n    );\n    const starProcedures = await supabaseAdminRequest(\n      context.env,\n      \"star_procedures?select=id,runway_config_id,designator,entry_fix,effective_from,effective_to,active&active=eq.true&order=designator.asc\",\n    );\n\n    return Response.json({\n      airports: airports.data ?? [],\n      runwayConfigs: runwayConfigs.data ?? [],\n      starProcedures: starProcedures.data ?? [],\n    }, {`
);

replace(
  'src/App.tsx',
  `type WorkspacePayload = {\n  airports: PublishedAirport[]\n  runwayConfigs: PublishedRunway[]\n}`,
  `type PublishedStarProcedure = {\n  id: string\n  runway_config_id: string\n  designator: string\n  entry_fix: string | null\n  effective_from: string | null\n  effective_to: string | null\n  active: boolean\n}\n\ntype WorkspacePayload = {\n  airports: PublishedAirport[]\n  runwayConfigs: PublishedRunway[]\n  starProcedures: PublishedStarProcedure[]\n}`
);
replace(
  'src/App.tsx',
  `  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspacePayload>({ airports: [], runwayConfigs: [] })`,
  `  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspacePayload>({ airports: [], runwayConfigs: [], starProcedures: [] })`
);
replace(
  'src/App.tsx',
  `        const config = await workspaceResponse.json() as WorkspacePayload`,
  `        const configPayload = await workspaceResponse.json() as Partial<WorkspacePayload>\n        const config: WorkspacePayload = {\n          airports: configPayload.airports ?? [],\n          runwayConfigs: configPayload.runwayConfigs ?? [],\n          starProcedures: configPayload.starProcedures ?? [],\n        }`
);
replace(
  'src/App.tsx',
  `                fixes={fixes.map((fix) => fix.fix)}\n                existingCallsigns={arrivals.map((row) => row.callsign)}`,
  `                fixes={fixes.map((fix) => fix.fix)}\n                starProcedures={workspaceConfig.starProcedures\n                  .filter((star) => star.runway_config_id === workspace.runwayId && star.active)\n                  .filter((star) => !session || (!star.effective_from || star.effective_from <= session.service_date) && (!star.effective_to || star.effective_to >= session.service_date))\n                  .flatMap((star) => star.entry_fix ? [{ designator: star.designator, entryFix: star.entry_fix }] : [])}\n                existingCallsigns={arrivals.map((row) => row.callsign)}`
);

replace(
  'src/IvaoTrafficPanel.tsx',
  `type Props = {\n  airport: string\n  fixes: string[]`,
  `type StarProcedure = { designator: string; entryFix: string }\n\ntype Props = {\n  airport: string\n  fixes: string[]\n  starProcedures: StarProcedure[]`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `  autoAssignedFix?: boolean\n  triggerSource?: 'live-route' | 'domestic-eet'`,
  `  autoAssignedFix?: boolean\n  filedStarDesignator?: string | null\n  triggerSource?: 'live-route' | 'domestic-eet'`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `function suggestedFix(route: string | null, fixes: string[]) {`,
  `function filedStarEntryFix(route: string | null, starProcedures: StarProcedure[], fixes: string[]) {\n  if (!route || !starProcedures.length) return null\n  const tokens = route.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)\n  const allowedFixes = new Set(fixes.map((fix) => fix.toUpperCase()))\n  let best: { designator: string; entryFix: string; index: number } | null = null\n  for (const star of starProcedures) {\n    const designator = star.designator.trim().toUpperCase()\n    const entryFix = star.entryFix.trim().toUpperCase()\n    if (!designator || !entryFix || !allowedFixes.has(entryFix)) continue\n    const index = tokens.lastIndexOf(designator)\n    if (index < 0) continue\n    if (!best || index > best.index) best = { designator, entryFix, index }\n  }\n  return best\n}\n\nfunction suggestedFix(route: string | null, fixes: string[]) {`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `export default function IvaoTrafficPanel({ airport, fixes, existingCallsigns, disabled, onAdd, onAddAll }: Props) {`,
  `export default function IvaoTrafficPanel({ airport, fixes, starProcedures, existingCallsigns, disabled, onAdd, onAddAll }: Props) {`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `    baseTimeIso: string,\n    autoAssignedFix = false,\n  ) => {\n    let estimate = autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin)`,
  `    baseTimeIso: string,\n    autoAssignedFix = false,\n    filedStarDesignator: string | null = null,\n  ) => {\n    let estimate: AutoEstimate = { ...autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin), filedStarDesignator }`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix }`,
  `        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix, filedStarDesignator }`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `        const filedSuggested = geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes)\n        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested\n        let estimate: AutoEstimate | null = null\n\n        if (previous?.refFixManual) {\n          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, false)\n        } else if (filedSuggested) {\n          estimate = autoEstimate(flight, geometry, filedSuggested, gs, nextFetchedAt, lookaheadMin)`,
  `        const filedStar = filedStarEntryFix(flight.route, starProcedures, fixes)\n        const filedSuggested = filedStar?.entryFix || (geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes))\n        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested\n        let estimate: AutoEstimate | null = null\n\n        if (previous?.refFixManual) {\n          estimate = await estimateForRefFix(flight, geometry, refFix, gs, nextFetchedAt, false)\n        } else if (filedStar) {\n          estimate = await estimateForRefFix(flight, geometry, filedStar.entryFix, gs, nextFetchedAt, false, filedStar.designator)\n        } else if (filedSuggested) {\n          estimate = autoEstimate(flight, geometry, filedSuggested, gs, nextFetchedAt, lookaheadMin)`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `  }, [airport, autoAssignUnfiledFix, estimateForRefFix, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed])`,
  `  }, [airport, autoAssignUnfiledFix, estimateForRefFix, fixes, getRouteGeometry, lookaheadMin, setDraftState, smoothedGroundSpeed, starProcedures])`
);

replace(
  'src/IvaoTrafficPanel.tsx',
  `  const domesticEta = estimate.triggerSource === 'domestic-eet' && estimate.triggerEta\n    ? ' · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z'\n    : ''`,
  `  const domesticEta = estimate.triggerSource === 'domestic-eet' && estimate.triggerEta\n    ? ' · DOM EET ETA ' + formatUtcHhmm(new Date(estimate.triggerEta).getTime()) + 'Z'\n    : ''\n  const filedStar = estimate.filedStarDesignator ? ' · FILED STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix : ''`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta`,
  `      if (estimate.assumedDirect && estimate.filedStarDesignator) return 'MANUAL ETO · filed STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix + ' · ' + estimate.eto + 'Z available' + domesticEta\n      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT' + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta`,
  `      const routeLabel = estimate.filedStarDesignator ? filedStar + ' · ROUTE→STAR ENTRY' : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT'\n      return 'AUTO ETO · ' + estimate.refFix + ' ~' + estimate.eto + 'Z' + routeLabel + past + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `      const assumed = estimate.assumedDirect ? ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT' : ''`,
  `      const assumed = estimate.assumedDirect ? (estimate.filedStarDesignator ? filedStar + ' · ROUTE→STAR ENTRY' : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT') : ''`
);
replace(
  'src/IvaoTrafficPanel.tsx',
  `    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'`,
  `    if (estimate.assumedDirect && estimate.filedStarDesignator) return 'AUTO ETO waiting' + filedStar + ' · ROUTE→STAR ENTRY · ETA >' + lookaheadMin + ' min'\n    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'`
);

replace(
  'README.md',
  `- The system prefers the next configured reference fix that is still ahead on the resolved route.\n- If all configured fixes have already been passed, it selects the most recently passed configured fix when possible.`,
  `- If the filed route contains a configured STAR designator (for example \`SABAI3A\`), the system maps that procedure through \`star_procedures\` and prioritizes its configured entry fix (for example \`SABAI\`) as the REF FIX.\n- This STAR-designator mapping takes priority over an earlier configured waypoint that also appears in the en-route portion of the FPL.\n- If the route parser does not expand the STAR procedure into its entry fix, the estimator bridges the resolved filed route to the mapped STAR entry for planning while labelling it as \`FILED STAR ... · STAR ENTRY ... · ROUTE→STAR ENTRY\`.\n- Otherwise the system prefers the next configured reference fix that is still ahead on the resolved route.\n- If all configured fixes have already been passed, it selects the most recently passed configured fix when possible.`
);

for (const path of ['scripts/patch-filed-star-detection.cjs', '.github/workflows/patch-filed-star-detection.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
