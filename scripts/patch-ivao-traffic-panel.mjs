import fs from 'node:fs'

const path = 'src/App.tsx'
let text = fs.readFileSync(path, 'utf8')

const importMarker = `import { useAuthUser } from './AuthGate'`
const importInsert = `import { useAuthUser } from './AuthGate'\nimport IvaoTrafficPanel, { type TrafficFlight } from './IvaoTrafficPanel'`
if (!text.includes(importMarker)) throw new Error('AuthGate import marker not found')
if (!text.includes("./IvaoTrafficPanel")) text = text.replace(importMarker, importInsert)

const deleteMarker = `  const deleteFlight = async (row: ArrivalView) => {`
const addFunction = `  const addIvaoFlight = async (flight: TrafficFlight, refFix: string, eto: string) => {\n    if (!session) throw new Error('No active sequence session')\n    const sequenceNo = arrivals.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1\n    await sequenceApi('/api/sequence/arrival', {\n      action: 'create',\n      sessionId: session.id,\n      sequenceNo,\n      callsign: flight.callsign,\n      aircraftType: flight.aircraft,\n      departure: flight.departure,\n      refFix,\n      eto: isoFromClock(session.service_date, eto),\n    })\n  }\n\n`
if (!text.includes(deleteMarker)) throw new Error('deleteFlight marker not found')
if (!text.includes('const addIvaoFlight')) text = text.replace(deleteMarker, addFunction + deleteMarker)

const toolbarMarker = `              <button className="primary-button" onClick={() => void addFlight()} disabled={!session || !workspace?.timingReady || fixes.length === 0}>+ Add Flight</button>\n              <input aria-label="Search flights"`
const toolbarReplacement = `              <button className="primary-button" onClick={() => void addFlight()} disabled={!session || !workspace?.timingReady || fixes.length === 0}>+ Add Flight</button>\n              {workspace && <IvaoTrafficPanel\n                airport={workspace.airport}\n                fixes={fixes.map((fix) => fix.fix)}\n                existingCallsigns={arrivals.map((row) => row.callsign)}\n                disabled={!session || !workspace.timingReady || fixes.length === 0}\n                onAdd={addIvaoFlight}\n              />}\n              <input aria-label="Search flights"`
if (!text.includes(toolbarMarker)) throw new Error('toolbar marker not found')
text = text.replace(toolbarMarker, toolbarReplacement)

fs.writeFileSync(path, text)
