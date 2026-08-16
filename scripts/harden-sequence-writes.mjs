import fs from 'node:fs'

function replaceOrFail(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing target: ${label}`)
  return source.replace(search, replacement)
}

let app = fs.readFileSync('src/App.tsx', 'utf8')

const helperAnchor = `type EditingState = Record<string, { displayName: string }>`
const helper = `async function sequenceApi(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { error?: string; session?: unknown; timingReady?: boolean; data?: unknown }
  if (!response.ok) throw new Error(payload.error || \`Sequence API returned \${response.status}\`)
  return payload
}

${helperAnchor}`
app = replaceOrFail(app, helperAnchor, helper, 'sequenceApi helper')

const sessionPattern = /        const todayUtc = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)[\s\S]*?        if \(disposed \|\| !activeSession\) return/
if (!sessionPattern.test(app)) throw new Error('Missing session bootstrap block')
app = app.replace(sessionPattern, `        const sessionPayload = await sequenceApi('/api/sequence/session', {
          airport: selectedWorkspace.airport,
          flow: selectedWorkspace.flow,
        })
        const activeSession = sessionPayload.session as SequenceSession | null
        if (disposed || !activeSession) return`)

app = replaceOrFail(app,
`      const { error: updateError } = await supabase.from('arrivals').update(patch).eq('id', row.id)
      if (updateError) throw updateError`,
`      await sequenceApi('/api/sequence/arrival', { action: 'update', id: row.id, values: patch })`,
'generic arrival update')

app = replaceOrFail(app,
`      const { error: updateError } = await supabase
        .from('arrivals')
        .update({ cldt: row.eldt })
        .eq('id', row.id)
      if (updateError) throw updateError`,
`      await sequenceApi('/api/sequence/arrival', { action: 'update', id: row.id, values: { cldt: row.eldt } })`,
'reset CLDT')

app = replaceOrFail(app,
`      const { error: updateError } = await supabase
        .from('arrivals')
        .update({ aldt: new Date().toISOString(), status: 'LANDED' })
        .eq('id', row.id)
      if (updateError) throw updateError`,
`      await sequenceApi('/api/sequence/arrival', { action: 'update', id: row.id, values: { aldt: new Date().toISOString(), status: 'LANDED' } })`,
'landed now')

app = replaceOrFail(app,
`    const { error: updateError } = await supabase.from('arrivals').update(patch).eq('id', row.id)
    if (updateError) setError(updateError.message)`,
`    try {
      await sequenceApi('/api/sequence/arrival', { action: 'update', id: row.id, values: patch })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }`,
'status update')

const addPattern = /      const \{ error: insertError \} = await supabase\.from\('arrivals'\)\.insert\(\{[\s\S]*?      if \(insertError\) throw insertError/
if (!addPattern.test(app)) throw new Error('Missing add flight insert')
app = app.replace(addPattern, `      await sequenceApi('/api/sequence/arrival', {
        action: 'create',
        sessionId: session.id,
        sequenceNo,
        callsign: 'NEW',
        aircraftType: null,
        departure: null,
        refFix: fixes[0].fix,
        eto: isoFromClock(session.service_date, hhmm),
      })`)

app = replaceOrFail(app,
`    const { error: deleteError } = await supabase.from('arrivals').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message)`,
`    try {
      await sequenceApi('/api/sequence/arrival', { action: 'delete', id: row.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }`,
'delete arrival')

fs.writeFileSync('src/App.tsx', app)

let main = fs.readFileSync('src/main.tsx', 'utf8')
main = main.replace("import { installAuditIdentity } from './auditIdentity'\n", '')
main = main.replace('installAuditIdentity()\n', '')
fs.writeFileSync('src/main.tsx', main)

console.log('Sequence browser writes routed through authenticated Cloudflare APIs.')
