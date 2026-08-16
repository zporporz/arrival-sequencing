import fs from 'node:fs'

const path = 'src/IvaoTrafficPanel.tsx'
let text = fs.readFileSync(path, 'utf8')

const oldCalculation = `  const remainingNm = Math.max(0, targetDistance - progress.progressNm) + progress.offRouteNm\n  const minutes = remainingNm / groundSpeed * 60\n  const baseTime = new Date(baseTimeIso).getTime()\n  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now()\n  const eto = formatUtcHhmm(safeBaseTime + minutes * 60_000)\n\n  if (minutes > AUTO_ETO_LOOKAHEAD_MIN) {\n    return { status: 'waiting', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: \`Outside \${AUTO_ETO_LOOKAHEAD_MIN} min auto-fill window\` }\n  }`
const newCalculation = `  const remainingNm = Math.max(0, targetDistance - progress.progressNm) + progress.offRouteNm\n  const minutesToFix = remainingNm / groundSpeed * 60\n  const finalSegment = geometry.segments[geometry.segments.length - 1]\n  const routeEndDistance = geometry.totalDistance ?? finalSegment?.cumulativeDistance ?? targetDistance\n  const remainingToDestinationNm = Math.max(0, routeEndDistance - progress.progressNm) + progress.offRouteNm\n  const minutes = remainingToDestinationNm / groundSpeed * 60\n  const baseTime = new Date(baseTimeIso).getTime()\n  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now()\n  const eto = formatUtcHhmm(safeBaseTime + minutesToFix * 60_000)\n\n  if (minutes > AUTO_ETO_LOOKAHEAD_MIN) {\n    return { status: 'waiting', refFix, eto, remainingNm, minutes, groundSpeed, offRouteNm: progress.offRouteNm, reason: \`Outside \${AUTO_ETO_LOOKAHEAD_MIN} min ETA window\` }\n  }`
if (!text.includes(oldCalculation)) throw new Error('AUTO ETO calculation block not found')
text = text.replace(oldCalculation, newCalculation)

const oldWaiting = `    return \`AUTO ETO waiting · \${Math.ceil(estimate.minutes || 0)} min to \${estimate.refFix} · auto-fill starts ≤\${AUTO_ETO_LOOKAHEAD_MIN} min\``
const newWaiting = `    return \`AUTO ETO waiting · ~\${Math.ceil(estimate.minutes || 0)} min to destination · auto-fill starts ETA ≤\${AUTO_ETO_LOOKAHEAD_MIN} min\``
if (!text.includes(oldWaiting)) throw new Error('AUTO ETO waiting label not found')
text = text.replace(oldWaiting, newWaiting)

const oldHeader = `            <span>AUTO ETO uses filed-route distance + live GS inside the final {AUTO_ETO_LOOKAHEAD_MIN} minutes. Manual override remains available.</span>`
const newHeader = `            <span>AUTO ETO uses filed-route distance + live GS when estimated arrival is within {AUTO_ETO_LOOKAHEAD_MIN} minutes. Manual override remains available.</span>`
if (!text.includes(oldHeader)) throw new Error('AUTO ETO header not found')
text = text.replace(oldHeader, newHeader)

const failedCache = `        geometryCacheRef.current.set(key, null)\n        return null`
if (!text.includes(failedCache)) throw new Error('Route failure cache block not found')
text = text.replace(failedCache, `        return null`)

fs.writeFileSync(path, text)
