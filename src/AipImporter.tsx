import { useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { normalizeRunwayLabel, parseAipIssueMetadata, parseAipStarText, type ParsedAipStar } from './aipStarParser'
import './aipImporter.css'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Airport = { id: string; icao: string; name: string; active: boolean; published: boolean }
type RunwayConfig = { id: string; airport_id: string; flow: string; label: string; active: boolean; published: boolean }
type StarProcedure = {
  id: string
  runway_config_id: string
  designator: string
  entry_fix: string | null
  runway_applicability: string | null
  chart_reference: string | null
  source: string | null
  effective_from: string | null
  active: boolean
}

type Props = {
  airports: Airport[]
  runwayConfigs: RunwayConfig[]
  starProcedures: StarProcedure[]
  reload: () => Promise<void>
}

type ScanIssue = {
  folder?: string
  airac: string | null
  effectiveDate: string | null
  publicationDate: string | null
  sourceUrl?: string | null
  coverUrl?: string | null
}

type ImportRecord = ParsedAipStar & {
  source?: string | null
  key: string
  runwayConfigId: string | null
  status: 'NEW' | 'CHANGED' | 'SAME' | 'UNMAPPED' | 'REVIEW'
  selected: boolean
}

function sameValue(left: string | null | undefined, right: string | null | undefined) {
  return (left || '') === (right || '')
}

function sourceForPdf(issue: ScanIssue, record: ParsedAipStar, fileName: string) {
  const airac = issue.airac ? `AIRAC ${issue.airac}` : 'AIRAC unknown'
  return `CAAT AIP PDF upload ${airac}; ${record.chartReference}; file ${fileName}`.slice(0, 300)
}

async function extractAipPdf(file: File, onProgress: (label: string) => void) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data: bytes }).promise
  const metadataPages: string[] = []
  const starPages: string[] = []
  let foundStar = false
  let postStarPages = 0
  const scanLimit = Math.min(pdf.numPages, 220)

  for (let pageNumber = 1; pageNumber <= scanLimit; pageNumber += 1) {
    onProgress(`Reading PDF page ${pageNumber} / ${scanLimit}…`)
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/[\u00ad\ufffe\uffff]/g, '')

    if (pageNumber <= 10) metadataPages.push(pageText)
    const hasStarHeading = /Standard\s+Arrival\s+Chart\s*-?\s*Instrument\s*\(STAR\)/i.test(pageText)
    if (hasStarHeading) foundStar = true

    if (foundStar) {
      starPages.push(pageText)
      postStarPages += 1
      if (/Instrument\s+Approach\s+Chart\s*-?\s*ICAO/i.test(pageText) && postStarPages > 1) break
      if (postStarPages >= 8) break
    }
  }

  if (!foundStar) throw new Error(`STAR chart list was not found in the first ${scanLimit} PDF pages.`)
  return {
    text: [...metadataPages, ...starPages].join('\n'),
    pageCount: pdf.numPages,
  }
}

export default function AipImporter({ airports, runwayConfigs, starProcedures, reload }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [records, setRecords] = useState<ImportRecord[]>([])
  const [issue, setIssue] = useState<ScanIssue | null>(null)
  const [mode, setMode] = useState<'AUTO' | 'PDF' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('ALL')

  const mapRecords = (parsed: ParsedAipStar[], sourceIssue: ScanIssue, sourceMode: 'AUTO' | 'PDF', fileName = '') => {
    const mapped = parsed.map((record) => {
      const airport = airports.find((item) => item.icao.toUpperCase() === record.airport)
      const runway = airport
        ? runwayConfigs.find((item) => item.airport_id === airport.id && normalizeRunwayLabel(item.label) === normalizeRunwayLabel(record.runwayApplicability))
        : undefined
      const existing = runway
        ? starProcedures.find((item) => item.runway_config_id === runway.id && item.designator === record.designator)
        : undefined
      const source = sourceMode === 'PDF' ? sourceForPdf(sourceIssue, record, fileName) : (record.source || record.sourceLabel)
      let status: ImportRecord['status'] = 'NEW'
      if (!runway) status = 'UNMAPPED'
      else if (!record.effectiveFrom) status = 'REVIEW'
      else if (existing) {
        const changed = !sameValue(existing.entry_fix, record.entryFix)
          || !sameValue(existing.runway_applicability, record.runwayApplicability)
          || !sameValue(existing.chart_reference, record.chartReference)
          || !sameValue(existing.effective_from, record.effectiveFrom)
          || existing.active !== true
        status = changed ? 'CHANGED' : 'SAME'
      }
      const key = `${record.airport}:${record.runwayApplicability}:${record.designator}:${record.chartReference}`
      return {
        ...record,
        source,
        key,
        runwayConfigId: runway?.id || null,
        status,
        selected: Boolean(runway && record.effectiveFrom && status !== 'SAME'),
      }
    })
    setRecords(mapped)
  }

  const scanAuto = async () => {
    setBusy(true)
    setError(null)
    setMessage('Checking CAAT Published eAIPs…')
    try {
      const response = await fetch('/api/admin/aip-import', { credentials: 'same-origin', cache: 'no-store' })
      const payload = await response.json() as { issue?: ScanIssue; records?: ParsedAipStar[]; error?: string }
      if (!response.ok) throw new Error(payload.error || `AIP scan returned ${response.status}`)
      const nextIssue = payload.issue || { airac: null, effectiveDate: null, publicationDate: null }
      setIssue(nextIssue)
      setMode('AUTO')
      mapRecords(payload.records || [], nextIssue, 'AUTO')
      setMessage(`Detected ${payload.records?.length || 0} STAR records from CAAT eAIP.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMessage('')
    } finally {
      setBusy(false)
    }
  }

  const parsePdf = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select an AIP PDF file.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage('Opening PDF…')
    try {
      const extracted = await extractAipPdf(file, setMessage)
      const metadata = parseAipIssueMetadata(extracted.text)
      const nextIssue: ScanIssue = { ...metadata }
      const parsed = parseAipStarText(extracted.text, {
        sourceKind: 'PDF_UPLOAD',
        sourceLabel: `Uploaded AIP PDF ${file.name}`,
      })
      if (!parsed.length) throw new Error('No STAR procedures were parsed from the PDF STAR chart list.')
      setIssue(nextIssue)
      setMode('PDF')
      mapRecords(parsed, nextIssue, 'PDF', file.name)
      setMessage(`Parsed ${parsed.length} STAR records from ${file.name}. PDF has ${extracted.pageCount} pages.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMessage('')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleRecord = (key: string, selected: boolean) => {
    setRecords((current) => current.map((record) => record.key === key ? { ...record, selected } : record))
  }

  const updateRecord = (key: string, patch: Partial<ImportRecord>) => {
    setRecords((current) => current.map((record) => {
      if (record.key !== key) return record
      const next = { ...record, ...patch }
      if (next.runwayConfigId && next.effectiveFrom && next.status === 'REVIEW') next.status = 'CHANGED'
      next.selected = Boolean(next.runwayConfigId && next.effectiveFrom && next.status !== 'SAME')
      return next
    }))
  }

  const approve = async () => {
    const selected = records.filter((record) => record.selected && record.runwayConfigId && record.effectiveFrom)
    if (!selected.length) return
    setBusy(true)
    setError(null)
    setMessage(`Importing ${selected.length} approved STAR records…`)
    try {
      const response = await fetch('/api/admin/aip-import', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          records: selected.map((record) => ({
            runwayConfigId: record.runwayConfigId,
            designator: record.designator,
            entryFix: record.entryFix,
            runwayApplicability: record.runwayApplicability,
            chartReference: record.chartReference,
            source: record.source,
            effectiveFrom: record.effectiveFrom,
          })),
        }),
      })
      const payload = await response.json() as { result?: { created: number; updated: number; unchanged: number }; error?: string }
      if (!response.ok) throw new Error(payload.error || `Import returned ${response.status}`)
      await reload()
      const summary = payload.result
      setMessage(`Import complete: ${summary?.created || 0} created, ${summary?.updated || 0} updated, ${summary?.unchanged || 0} unchanged.`)
      setRecords((current) => current.map((record) => record.selected ? { ...record, selected: false, status: 'SAME' } : record))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMessage('')
    } finally {
      setBusy(false)
    }
  }

  const visible = useMemo(() => records.filter((record) => filter === 'ALL' || record.status === filter), [records, filter])
  const selectedCount = records.filter((record) => record.selected).length
  const count = (status: ImportRecord['status']) => records.filter((record) => record.status === status).length

  return (
    <section className="admin-card wide-card aip-importer">
      <div className="admin-card-heading aip-import-heading">
        <div>
          <span className="admin-label">AIP IMPORT · REVIEW BEFORE APPLY</span>
          <h2>CAAT STAR Importer</h2>
          <p>Detect the current CAAT eAIP or parse an uploaded AIP PDF. Nothing changes until staff approves the preview.</p>
        </div>
        <div className="aip-import-actions">
          <button className="primary-admin-action" disabled={busy} onClick={() => void scanAuto()}>{busy && mode !== 'PDF' ? 'Scanning…' : 'Check latest CAAT AIP'}</button>
          <button disabled={busy} onClick={() => fileRef.current?.click()}>Upload PDF</button>
          <input ref={fileRef} className="aip-hidden-file" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parsePdf(file) }} />
        </div>
      </div>

      <div className="aip-source-strip">
        <div><span>SOURCE</span><strong>{mode === 'AUTO' ? 'CAAT eAIP auto-detect' : mode === 'PDF' ? 'Uploaded AIP PDF' : 'Not scanned'}</strong></div>
        <div><span>AIRAC</span><strong>{issue?.airac || '—'}</strong></div>
        <div><span>ISSUE EFFECTIVE</span><strong>{issue?.effectiveDate || '—'}</strong></div>
        <div><span>PARSED</span><strong>{records.length}</strong></div>
      </div>

      {message && <div className="aip-message">{message}</div>}
      {error && <div className="admin-error"><strong>AIP Import:</strong> {error}</div>}

      {records.length > 0 && (
        <>
          <div className="aip-diff-toolbar">
            <div className="aip-diff-filters">
              {(['ALL', 'NEW', 'CHANGED', 'SAME', 'REVIEW', 'UNMAPPED'] as const).map((item) => (
                <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                  {item} {item === 'ALL' ? records.length : count(item as ImportRecord['status'])}
                </button>
              ))}
            </div>
            <button className="primary-admin-action" disabled={busy || selectedCount === 0} onClick={() => void approve()}>
              Approve import ({selectedCount})
            </button>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table aip-import-table">
              <thead><tr><th>USE</th><th>ICAO</th><th>RUNWAY</th><th>STAR</th><th>ENTRY FIX</th><th>CHART</th><th>EFFECTIVE</th><th>DIFF</th></tr></thead>
              <tbody>
                {visible.map((record) => {
                  const airport = airports.find((item) => item.icao === record.airport)
                  return <tr key={record.key} className={`aip-row aip-${record.status.toLowerCase()}`}>
                    <td><input type="checkbox" checked={record.selected} disabled={!record.runwayConfigId || !record.effectiveFrom || record.status === 'SAME'} onChange={(event) => toggleRecord(record.key, event.target.checked)} /></td>
                    <td><strong>{record.airport}</strong><small>{airport?.name || 'Airport not in Admin'}</small></td>
                    <td><strong>{record.runwayApplicability}</strong><small>{record.runwayConfigId ? 'Mapped to runway config' : 'Create/map runway config first'}</small></td>
                    <td><strong>{record.designator}</strong></td>
                    <td><input value={record.entryFix} onChange={(event) => updateRecord(record.key, { entryFix: event.target.value.toUpperCase() })} /></td>
                    <td><span>{record.chartReference}</span></td>
                    <td><input type="date" value={record.effectiveFrom || ''} onChange={(event) => updateRecord(record.key, { effectiveFrom: event.target.value || null })} /></td>
                    <td><span className={`aip-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          <div className="timing-note">PDF parsing never invents a missing chart effective date. Rows marked REVIEW must be checked before they can be approved. Import does not change timing data and does not auto-archive STARs missing from the source.</div>
        </>
      )}
    </section>
  )
}
