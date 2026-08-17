const fs = require('fs')

const appPath = 'src/App.tsx'
let app = fs.readFileSync(appPath, 'utf8')

function replaceOnce(from, to, label) {
  if (!app.includes(from)) throw new Error('Missing App.tsx pattern: ' + label)
  app = app.replace(from, to)
}

replaceOnce(
  "type EditingState = Record<string, { displayName: string }>",
  "type EditingState = Record<string, { displayName: string; userId: string }>",
  'EditingState userId',
)

replaceOnce(
`          .on('broadcast', { event: 'editing' }, ({ payload }) => {
            if (!payload || payload.userId === identity.id) return
            const key = \`${'${payload.arrivalId}:${payload.field}'}\`
            setEditing((current) => ({ ...current, [key]: { displayName: payload.displayName } }))
          })`,
`          .on('broadcast', { event: 'editing' }, ({ payload }) => {
            if (!payload || payload.userId === identity.id) return
            const key = \`${'${payload.arrivalId}:${payload.field}'}\`
            setEditing((current) => {
              const next = { ...current }
              for (const [editingKey, editor] of Object.entries(next)) {
                if (editor.userId === payload.userId && editingKey !== key) delete next[editingKey]
              }
              next[key] = { displayName: payload.displayName, userId: payload.userId }
              return next
            })
          })`,
  'editing broadcast single-active-cell cleanup',
)

replaceOnce(
`  onStart: (arrivalId: string, field: string) => void
  onSave: (row: ArrivalView, field: string, value: string | null) => Promise<void>`,
`  onStart: (arrivalId: string, field: string) => void
  onStop: (arrivalId: string, field: string) => void
  onSave: (row: ArrivalView, field: string, value: string | null) => Promise<void>`,
  'EditorCommon onStop',
)

const editorPropPattern = 'onStart={startEditing} onSave={updateArrival}'
const editorPropCount = app.split(editorPropPattern).length - 1
if (editorPropCount !== 6) throw new Error('Expected 6 editor prop occurrences, found ' + editorPropCount)
app = app.split(editorPropPattern).join('onStart={startEditing} onStop={stopEditing} onSave={updateArrival}')

replaceOnce(
`                          <select className="cell-select" value={row.ref_fix} disabled={savingCell === \`${'${row.id}:ref_fix'}\`} onFocus={() => startEditing(row.id, 'ref_fix')} onChange={(event) => void updateArrival(row, 'ref_fix', event.target.value)}>`,
`                          <select className="cell-select" value={row.ref_fix} disabled={savingCell === \`${'${row.id}:ref_fix'}\`} onFocus={() => startEditing(row.id, 'ref_fix')} onBlur={() => stopEditing(row.id, 'ref_fix')} onChange={(event) => void updateArrival(row, 'ref_fix', event.target.value)}>`,
  'REF FIX blur cleanup',
)

replaceOnce(
`function EditableText({ row, field, value, saving, editing, onStart, onSave, bold = false }: EditorCommon & { value: string; bold?: boolean }) {`,
`function EditableText({ row, field, value, saving, editing, onStart, onStop, onSave, bold = false }: EditorCommon & { value: string; bold?: boolean }) {`,
  'EditableText onStop signature',
)

replaceOnce(
`      <input className={\`cell-input${'${bold ? \' bold\' : \'\'}'}\`} value={draft} disabled={saving === key} onFocus={() => onStart(row.id, field)} onChange={(event) => setDraft(event.target.value.toUpperCase())} onBlur={() => { if (draft.trim() !== value) void onSave(row, field, draft.trim() || null) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />`,
`      <input className={\`cell-input${'${bold ? \' bold\' : \'\'}'}\`} value={draft} disabled={saving === key} onFocus={() => onStart(row.id, field)} onChange={(event) => setDraft(event.target.value.toUpperCase())} onBlur={() => { if (draft.trim() !== value) void onSave(row, field, draft.trim() || null); onStop(row.id, field) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />`,
  'EditableText blur cleanup',
)

replaceOnce(
`function EditableTime({ row, field, value, saving, editing, onStart, onSave, strong = false, allowEmpty = false }: EditorCommon & { value: string | null; strong?: boolean; allowEmpty?: boolean }) {`,
`function EditableTime({ row, field, value, saving, editing, onStart, onStop, onSave, strong = false, allowEmpty = false }: EditorCommon & { value: string | null; strong?: boolean; allowEmpty?: boolean }) {`,
  'EditableTime onStop signature',
)

replaceOnce(
`        onBlur={commit}`,
`        onBlur={() => { commit(); onStop(row.id, field) }}`,
  'EditableTime blur cleanup',
)

fs.writeFileSync(appPath, app)

const readmePath = 'README.md'
let readme = fs.readFileSync(readmePath, 'utf8')
const needle = '- Live edit presence shows when another controller is editing a field.\n'
if (!readme.includes(needle)) throw new Error('README presence bullet not found')
readme = readme.replace(needle, needle + '- Edit presence is focus-scoped: moving to another field or leaving a field clears the previous editor badge, with one active cell tracked per controller.\n')
fs.writeFileSync(readmePath, readme)

// Keep the repository clean after the patch workflow commits the result.
for (const path of ['scripts/patch-editing-presence.cjs', '.github/workflows/patch-editing-presence.yml']) {
  if (fs.existsSync(path)) fs.rmSync(path)
}
