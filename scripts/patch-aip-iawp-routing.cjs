const fs = require('fs')

function replace(path, from, to) {
  let s = fs.readFileSync(path, 'utf8')
  if (!s.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0, 160)}`)
  s = s.replace(from, to)
  fs.writeFileSync(path, s)
}

replace(
  'src/IvaoTrafficPanel.tsx',
  `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\nimport './ivaoTraffic.css'`,
  `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\nimport { findAipIawp } from './aipArrivalIawp'\nimport './ivaoTraffic.css'`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `  filedStarDesignator?: string | null\n  triggerSource?: 'live-route' | 'domestic-eet'`,
  `  filedStarDesignator?: string | null\n  aipMappedFrom?: string | null\n  triggerSource?: 'live-route' | 'domestic-eet'`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `  const filedStar = estimate.filedStarDesignator ? ' · FILED STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix : ''`,
  `  const filedStar = estimate.filedStarDesignator ? ' · FILED STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix : ''\n  const aipIawp = estimate.aipMappedFrom ? ' · AIP IAWP ' + estimate.refFix + ' · FROM ' + estimate.aipMappedFrom : ''`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `      if (estimate.assumedDirect && estimate.filedStarDesignator) return 'MANUAL ETO · filed STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix + ' · ' + estimate.eto + 'Z available' + domesticEta\n      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta`,
  `      if (estimate.assumedDirect && estimate.filedStarDesignator) return 'MANUAL ETO · filed STAR ' + estimate.filedStarDesignator + ' · STAR ENTRY ' + estimate.refFix + ' · ' + estimate.eto + 'Z available' + domesticEta\n      if (estimate.assumedDirect && estimate.aipMappedFrom) return 'MANUAL ETO · AIP IAWP ' + estimate.refFix + ' from ' + estimate.aipMappedFrom + ' · ' + estimate.eto + 'Z available' + domesticEta\n      if (estimate.assumedDirect) return 'MANUAL ETO · assumed-DCT auto estimate ' + estimate.refFix + ' ' + estimate.eto + 'Z available' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED REF FIX' : '') + domesticEta`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `      const routeLabel = estimate.filedStarDesignator ? filedStar + ' · ROUTE→STAR ENTRY' : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT'`,
  `      const routeLabel = estimate.filedStarDesignator\n        ? filedStar + ' · ROUTE→STAR ENTRY'\n        : estimate.aipMappedFrom\n          ? aipIawp + ' · ROUTE→IAWP'\n          : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT'`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `    return 'AUTO ETO · ' + estimate.refFix + ' ' + estimate.eto + 'Z · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta`,
  `    return 'AUTO ETO · ' + estimate.refFix + ' ' + estimate.eto + 'Z' + aipIawp + ' · ' + Math.round(estimate.remainingNm || 0) + ' NM · GS ' + Math.round(estimate.groundSpeed || 0) + domesticEta`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `      const assumed = estimate.assumedDirect ? (estimate.filedStarDesignator ? filedStar + ' · ROUTE→STAR ENTRY' : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT') : ''`,
  `      const assumed = estimate.assumedDirect\n        ? (estimate.filedStarDesignator\n          ? filedStar + ' · ROUTE→STAR ENTRY'\n          : estimate.aipMappedFrom\n            ? aipIawp + ' · ROUTE→IAWP'\n            : ' · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT')\n        : aipIawp`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `    if (estimate.assumedDirect && estimate.filedStarDesignator) return 'AUTO ETO waiting' + filedStar + ' · ROUTE→STAR ENTRY · ETA >' + lookaheadMin + ' min'\n    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'`,
  `    if (estimate.assumedDirect && estimate.filedStarDesignator) return 'AUTO ETO waiting' + filedStar + ' · ROUTE→STAR ENTRY · ETA >' + lookaheadMin + ' min'\n    if (estimate.assumedDirect && estimate.aipMappedFrom) return 'AUTO ETO waiting' + aipIawp + ' · ROUTE→IAWP · ETA >' + lookaheadMin + ' min'\n    if (estimate.assumedDirect) return 'AUTO ETO waiting · REF FIX NOT FILED' + (estimate.autoAssignedFix ? ' · AUTO ASSIGNED' : '') + ' · ASSUMED DCT · ETA >' + lookaheadMin + ' min'`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `    autoAssignedFix = false,\n    filedStarDesignator: string | null = null,\n  ) => {\n    let estimate: AutoEstimate = { ...autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin), filedStarDesignator }`,
  `    autoAssignedFix = false,\n    filedStarDesignator: string | null = null,\n    aipMappedFrom: string | null = null,\n  ) => {\n    let estimate: AutoEstimate = { ...autoEstimate(flight, geometry, refFix, groundSpeed, baseTimeIso, lookaheadMin), filedStarDesignator, aipMappedFrom }`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix, filedStarDesignator }`,
  `        estimate = { ...assumedEstimate, assumedDirect: true, autoAssignedFix, filedStarDesignator, aipMappedFrom }`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `        const filedStar = filedStarEntryFix(flight.route, starProcedures, fixes)\n        const filedSuggested = filedStar?.entryFix || (geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes))\n        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested`,
  `        const filedStar = filedStarEntryFix(flight.route, starProcedures, fixes)\n        const starEntryFixes = [...new Set(starProcedures.map((star) => star.entryFix.toUpperCase()))]\n        const aipMapped = filedStar ? null : findAipIawp(airport, flight.route, starEntryFixes)\n        const filedSuggested = filedStar?.entryFix || aipMapped?.entryFix || (geometry ? upcomingConfiguredFix(flight, geometry, fixes) : suggestedFix(flight.route, fixes))\n        let refFix = previous?.refFixManual ? previous.refFix : filedSuggested`,
)

replace(
  'src/IvaoTrafficPanel.tsx',
  `        } else if (filedStar) {\n          estimate = await estimateForRefFix(flight, geometry, filedStar.entryFix, gs, nextFetchedAt, false, filedStar.designator)\n        } else if (filedSuggested) {`,
  `        } else if (filedStar) {\n          estimate = await estimateForRefFix(flight, geometry, filedStar.entryFix, gs, nextFetchedAt, false, filedStar.designator)\n        } else if (aipMapped) {\n          estimate = await estimateForRefFix(flight, geometry, aipMapped.entryFix, gs, nextFetchedAt, false, null, aipMapped.via)\n        } else if (filedSuggested) {`,
)

replace(
  'README.md',
  `- This STAR-designator mapping takes priority over an earlier configured waypoint that also appears in the en-route portion of the FPL.\n- If the route parser does not expand the STAR procedure into its entry fix, the estimator bridges the resolved filed route to the mapped STAR entry for planning while labelling it as \`FILED STAR ... · STAR ENTRY ... · ROUTE→STAR ENTRY\`.\n- Otherwise the system prefers the next configured reference fix that is still ahead on the resolved route.`,
  `- This STAR-designator mapping takes priority over an earlier configured waypoint that also appears in the en-route portion of the FPL.\n- If the route parser does not expand the STAR procedure into its entry fix, the estimator bridges the resolved filed route to the mapped STAR entry for planning while labelling it as \`FILED STAR ... · STAR ENTRY ... · ROUTE→STAR ENTRY\`.\n- If no STAR designator is filed, the system next applies CAAT AIP ENR 1.10 §4.3 transition-to-IAWP mappings for VTBD and VTBS. Examples include \`HOTEL → SABAI\` for VTBD, \`HOTEL → LEBIM\` for VTBS, \`BLAFF/NOBER/SEMBO/ALBOS → NAKON\` for VTBD and \`→ NORTA\` for VTBS, and the published east/west/north/south IAWP transitions.\n- AIP-derived mappings are labelled \`AIP IAWP <fix> · FROM <transition>\`; if the filed route stops at the transition waypoint, the estimator extends the planning geometry to the mapped IAWP and labels it \`ROUTE→IAWP\`.\n- Otherwise the system prefers the next configured reference fix that is still ahead on the resolved route.`,
)

for (const path of ['scripts/patch-aip-iawp-routing.cjs', '.github/workflows/patch-aip-iawp-routing.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path)
}
