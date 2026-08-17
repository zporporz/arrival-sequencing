const fs = require('fs');

function replace(path, from, to) {
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0, 120)}`);
  s = s.replace(from, to);
  fs.writeFileSync(path, s);
}

replace(
  'src/TimingEditor.tsx',
  `      const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))\n      const transitionWaypoints = (tablePayload.transitionWaypoints || []).map((fix) => fix.toUpperCase()).filter((fix) => !existingFixes.has(fix))\n      if (transitionWaypoints.length) {\n        const next = new Map<string, StarTimingDraft>()\n        for (const fix of transitionWaypoints) {\n          next.set(fix, {\n            fix,\n            minutes: '',\n            source: '',\n            effectiveFrom: defaultEffectiveFrom,\n            designators: [],\n            origin: 'AIP transition waypoint · AD 2.22 inbound routes',\n          })\n        }\n        const sorted = [...next.values()].sort((left, right) => left.fix.localeCompare(right.fix))\n        setStarDrafts(Object.fromEntries(sorted.map((draft) => [draft.fix, draft])))\n        setAipWaypointMessage(\`${'${sorted.length}'} transition REF FIX candidates loaded from CAAT AD 2.22. Nominal Min is still required.\`)\n        return\n      }`,
  `      const existingFixes = new Set(timings.map((timing) => timing.fix.toUpperCase()))\n      const starEntryFixes = new Set(runwayStars.map((star) => star.entry_fix?.trim().toUpperCase()).filter((fix): fix is string => Boolean(fix)))\n      const transitionWaypoints = (tablePayload.transitionWaypoints || [])\n        .map((fix) => fix.toUpperCase())\n        .filter((fix) => starEntryFixes.has(fix) && !existingFixes.has(fix))\n      if (transitionWaypoints.length) {\n        const next = new Map<string, StarTimingDraft>()\n        for (const fix of transitionWaypoints) {\n          const designators = runwayStars.filter((star) => star.entry_fix?.trim().toUpperCase() === fix).map((star) => star.designator)\n          next.set(fix, {\n            fix,\n            minutes: '',\n            source: '',\n            effectiveFrom: defaultEffectiveFrom,\n            designators,\n            origin: 'AIP STAR entry fix · AD 2.22',\n          })\n        }\n        const sorted = [...next.values()].sort((left, right) => left.fix.localeCompare(right.fix))\n        setStarDrafts(Object.fromEntries(sorted.map((draft) => [draft.fix, draft])))\n        setAipWaypointMessage(\`${'${sorted.length}'} missing STAR entry REF FIX ${'${sorted.length === 1 ? \'candidate\' : \'candidates\'}'} loaded from CAAT AD 2.22. Nominal Min is still required.\`)\n        return\n      }`
);

replace(
  'src/TimingEditor.tsx',
  `        const fixes = await extractWaypointFixes(await assetResponse.arrayBuffer())\n        for (const fix of fixes) {\n          if (existingFixes.has(fix)) continue`,
  `        const fixes = await extractWaypointFixes(await assetResponse.arrayBuffer())\n        for (const fix of fixes) {\n          if (!starEntryFixes.has(fix) || existingFixes.has(fix)) continue`
);

replace(
  'src/adminEditors.css',
  `.star-editor{overflow:hidden}`,
  `.admin-table thead th::after{content:none!important;display:none!important}.star-editor{overflow:hidden}`
);

for (const path of ['scripts/patch-timing-editor-aip.cjs', '.github/workflows/patch-timing-editor-aip.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
