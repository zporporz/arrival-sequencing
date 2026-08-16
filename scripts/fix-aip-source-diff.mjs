import fs from 'node:fs'

const path = 'src/AipImporter.tsx'
let text = fs.readFileSync(path, 'utf8')
const oldText = `          || !sameValue(existing.chart_reference, record.chartReference)\n          || !sameValue(existing.effective_from, record.effectiveFrom)\n          || !sameValue(existing.source, source)\n          || existing.active !== true`
const newText = `          || !sameValue(existing.chart_reference, record.chartReference)\n          || !sameValue(existing.effective_from, record.effectiveFrom)\n          || existing.active !== true`
if (!text.includes(oldText)) throw new Error('AIP diff comparison target not found')
text = text.replace(oldText, newText)
fs.writeFileSync(path, text)
