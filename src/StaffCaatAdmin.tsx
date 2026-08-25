import { useEffect, useState } from 'react'
import { useAuthUser } from './AuthGate'
import type { ParsedAipStar } from './aipStarParser'
import './staffCaatAdmin.css'

type Issue = { folder: string; airac: string | null; effectiveDate: string | null; publicationDate: string | null; sourceUrl: string }
type Airport = { id: string; icao: string; name: string }
type Runway = { id: string; airport_id: string; flow: string; label: string; active: boolean; published?: boolean }
type ExistingStar = { id: string; runway_config_id: string; designator: string; entry_fix: string | null; runway_applicability: string | null; chart_reference: string | null; effective_from: string | null; active: boolean; source: string | null }
type Dashboard = { airports: Airport[]; runwayConfigs: Runway[]; starProcedures: ExistingStar[] }
type ReviewStatus = 'NEW' | 'CHANGED' | 'SAME' | 'REVIEW' | 'UNMAPPED'
type ReviewRow = ParsedAipStar & { key: string; runwayConfigId: string; effectiveFrom: string; selected: boolean; status: ReviewStatus; source?: string | null }

const EMPTY_DASHBOARD: Dashboard = { airports: [], runwayConfigs: [], starProcedures: [] }

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `${url} returned ${response.status}`)
  return payload as T
}

function runwayTokens(value: string) {
  return String(value || '').toUpperCase().match(/\b\d{2}[LRC]?\b/g)?.sort().join('|') || ''
}

function rowStatus(row: ReviewRow, existing: ExistingStar[]): ReviewStatus {
  if (!row.runwayConfigId) return 'UNMAPPED'
  if (!row.effectiveFrom) return 'REVIEW'
  const match = existing.find((item) => item.runway_config_id === row.runwayConfigId
    && item.designator === row.designator
    && String(item.effective_from || '') === row.effectiveFrom)
  if (!match) return 'NEW'
  const same = (match.entry_fix || '') === row.entryFix
    && (match.runway_applicability || '') === row.runwayApplicability
    && (match.chart_reference || '') === row.chartReference
    && (match.source || '') === (row.source || '')
    && match.active !== false
  return same ? 'SAME' : 'CHANGED'
}

export default function StaffCaatAdmin() {
  const user = useAuthUser()
  const [dashboard, setDashboard] = useState<Dashboard>(EMPTY_DASHBOARD)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('READY')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!user.isThailandStaff) return
    readJson<Dashboard>('/api/admin/master').then(setDashboard).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [user.isThailandStaff])

  const scan = async () => {
    setBusy(true); setError(null); setStatus('SCANNING CAAT')
    try {
      const result = await readJson<{ issue: Issue; records: ParsedAipStar[] }>('/api/admin/aip-import')
      const nextRows = result.records.map((record, index) => {
        const airport = dashboard.airports.find((item) => item.icao === record.airport)
        const recordRunways = runwayTokens(record.runwayApplicability)
        const mapped = dashboard.runwayConfigs.find((item) => item.airport_id === airport?.id && runwayTokens(item.label) === recordRunways)
        const base: ReviewRow = { ...record, key: `${record.airport}:${record.designator}:${record.chartReference}:${index}`, runwayConfigId: mapped?.id || '', effectiveFrom: record.effectiveFrom || result.issue.effectiveDate || '', selected: false, status: 'REVIEW' }
        const nextStatus = rowStatus(base, dashboard.starProcedures)
        return { ...base, status: nextStatus, selected: nextStatus === 'NEW' || nextStatus === 'CHANGED' }
      })
      setIssue(result.issue); setRows(nextRows); setStatus(`REVIEW ${nextRows.length} RECORDS`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setStatus('SCAN FAILED')
    } finally { setBusy(false) }
  }

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row
      const next = { ...row, ...patch }
      const nextStatus = rowStatus(next, dashboard.starProcedures)
      return { ...next, status: nextStatus, selected: ['SAME', 'UNMAPPED', 'REVIEW'].includes(nextStatus) ? false : next.selected }
    }))
  }

  const approve = async () => {
    const selected = rows.filter((row) => row.selected && (row.status === 'NEW' || row.status === 'CHANGED'))
    if (!selected.length || !window.confirm(`Approve ${selected.length} reviewed CAAT STAR record(s) into master data?`)) return
    setBusy(true); setError(null); setStatus('IMPORTING')
    try {
      const result = await readJson<{ result: { created: number; updated: number; unchanged: number } }>('/api/admin/aip-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', records: selected.map((row) => ({ runwayConfigId: row.runwayConfigId, designator: row.designator, entryFix: row.entryFix, runwayApplicability: row.runwayApplicability, chartReference: row.chartReference, source: row.source, effectiveFrom: row.effectiveFrom })) }),
      })
      const summary = result.result
      setStatus(`DONE · ${summary.created} NEW · ${summary.updated} UPDATED · ${summary.unchanged} SAME`)
      setDashboard(await readJson<Dashboard>('/api/admin/master')); setRows([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setStatus('IMPORT FAILED')
    } finally { setBusy(false) }
  }

  if (!user.isThailandStaff) return <main className="caat-denied"><strong>STAFF ACCESS REQUIRED</strong><a href="/">Return to AMAN</a></main>
  const selectedCount = rows.filter((row) => row.selected).length

  return <div className="caat-app">
    <header className="caat-topbar"><div><span>IVAO THAILAND · STAFF</span><strong>CAAT eAIP REVIEW</strong></div><nav><a href="/?admin=tools">← ADMIN TOOLS</a><span>{user.name} · {user.vid}</span><a href="/api/auth/logout">Sign out</a></nav></header>
    <main className="caat-main">
      <section className="caat-hero"><div><span>OFFICIAL SOURCE CROSS-CHECK</span><h1>CAAT STAR Review</h1><p>Scan the effective CAAT eAIP, review every mapped STAR and approve only selected records.</p></div><b>{busy ? 'WORKING' : status}</b></section>
      <section className="caat-actions">
        <button className="primary" disabled={busy || !dashboard.airports.length} onClick={() => void scan()}>SCAN CURRENT CAAT AIRAC</button>
        <button disabled={busy || !selectedCount} onClick={() => void approve()}>APPROVE SELECTED ({selectedCount})</button>
        {issue && <div><strong>AIRAC {issue.airac || issue.folder}</strong><span>Effective {issue.effectiveDate || 'REVIEW DATE'} · Published {issue.publicationDate || '—'}</span><a href={issue.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a></div>}
      </section>
      {error && <div className="caat-error">{error}</div>}
      <section className="caat-summary">{(['NEW', 'CHANGED', 'SAME', 'REVIEW', 'UNMAPPED'] as const).map((item) => <article key={item}><span>{item}</span><strong>{rows.filter((row) => row.status === item).length}</strong></article>)}</section>
      <section className="caat-table-wrap"><table><thead><tr><th>USE</th><th>STATE</th><th>APT</th><th>STAR</th><th>ENTRY FIX</th><th>RUNWAY FLOW</th><th>EFFECTIVE</th><th>CHART</th></tr></thead><tbody>
        {rows.map((row) => {
          const airport = dashboard.airports.find((item) => item.icao === row.airport)
          const runwayOptions = dashboard.runwayConfigs.filter((item) => item.airport_id === airport?.id)
          return <tr key={row.key}><td><input type="checkbox" checked={row.selected} disabled={!['NEW', 'CHANGED'].includes(row.status)} onChange={(event) => updateRow(row.key, { selected: event.target.checked })} /></td><td><b className={`state-${row.status.toLowerCase()}`}>{row.status}</b></td><td>{row.airport}</td><td><strong>{row.designator}</strong></td><td><input value={row.entryFix} onChange={(event) => updateRow(row.key, { entryFix: event.target.value.toUpperCase() })} /></td><td><select value={row.runwayConfigId} onChange={(event) => updateRow(row.key, { runwayConfigId: event.target.value })}><option value="">UNMAPPED</option>{runwayOptions.map((runway) => <option value={runway.id} key={runway.id}>{runway.flow} · {runway.label}{runway.published ? ' · PUB' : ''}</option>)}</select></td><td><input type="date" value={row.effectiveFrom} onChange={(event) => updateRow(row.key, { effectiveFrom: event.target.value })} /></td><td title={row.source || ''}>{row.chartReference}<small>{row.runwayApplicability}</small></td></tr>
        })}
        {!rows.length && <tr><td colSpan={8} className="empty">Scan CAAT to load a review candidate. Nothing is written until staff approval.</td></tr>}
      </tbody></table></section>
      <p className="caat-note">CAAT import updates STAR master data only. It never changes nominal fix timings or publishes a runway flow automatically.</p>
    </main>
  </div>
}
