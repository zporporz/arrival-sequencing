const fs = require('fs');

function replace(path, from, to) {
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0, 140)}`);
  s = s.replace(from, to);
  fs.writeFileSync(path, s);
}

replace(
  'src/App.tsx',
  `const sameInstant = (left: string, right: string) => {`,
  `const airlineIcaoFromCallsign = (value: string | null | undefined) => {\n  const callsign = String(value || '').trim().toUpperCase()\n  const match = callsign.match(/^([A-Z]{3})[A-Z0-9]/)\n  return match?.[1] || null\n}\n\nconst sameInstant = (left: string, right: string) => {`
);

replace(
  'src/App.tsx',
  `<td><EditableText row={row} field="callsign" value={row.callsign} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} bold /></td>`,
  `<td>\n                        <div className="sequence-callsign-cell">\n                          {airlineIcaoFromCallsign(row.callsign) && <span className="sequence-airline-logo" aria-hidden="true"><img src={\`/api/sequence/airline-logo?icao=\${encodeURIComponent(airlineIcaoFromCallsign(row.callsign) || '')}\`} alt="" onError={(event) => { event.currentTarget.closest('.sequence-airline-logo')?.classList.add('is-missing') }} /></span>}\n                          <EditableText row={row} field="callsign" value={row.callsign} saving={savingCell} editing={editing} onStart={startEditing} onSave={updateArrival} bold />\n                        </div>\n                      </td>`
);

fs.appendFileSync('src/readability.css', `\n\n/* Airline logo in the live sequence callsign column. */\n.sequence-callsign-cell {\n  display: flex !important;\n  align-items: center !important;\n  gap: 8px !important;\n  min-width: 150px !important;\n}\n.sequence-callsign-cell .cell-editor-wrap {\n  flex: 1 1 auto !important;\n  min-width: 105px !important;\n}\n.sequence-airline-logo {\n  width: 30px !important;\n  height: 30px !important;\n  flex: 0 0 30px !important;\n  display: grid !important;\n  place-items: center !important;\n  overflow: hidden !important;\n  border: 1px solid #e0e6ef !important;\n  border-radius: 8px !important;\n  background: #fff !important;\n}\n.sequence-airline-logo img {\n  width: 100% !important;\n  height: 100% !important;\n  object-fit: contain !important;\n  padding: 3px !important;\n}\n.sequence-airline-logo.is-missing { display: none !important; }\n`);

for (const path of ['scripts/patch-sequence-airline-logo.cjs', '.github/workflows/patch-sequence-airline-logo.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}
