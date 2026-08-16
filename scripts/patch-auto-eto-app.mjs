import fs from 'node:fs'

const path = 'src/App.tsx'
let text = fs.readFileSync(path, 'utf8')
const oldValue = `      eto: isoFromClock(session.service_date, eto),`
const newValue = `      eto: isoFromClock(session.service_date, eto, new Date().toISOString()),`
const matches = text.split(oldValue).length - 1
if (matches !== 1) throw new Error(`Expected one IVAO ETO anchor target, found ${matches}`)
text = text.replace(oldValue, newValue)
fs.writeFileSync(path, text)
