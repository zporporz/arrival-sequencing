import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthUser } from './AuthGate'

const SQLJS_VERSION = '1.13.0'
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`
const SUPPORTED_NAVDATA_SOURCES = new Set(['NG', 'NAVIGRAPH'])

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>
  close: () => void
}
type SqlJsStatic = { Database: new (data: Uint8Array) => SqlJsDatabase }
type WindowSqlJs = Window & { initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic> }

type CycleSummary = {
  id: string
  cycle: string
  valid_through: string | null
  source_filename: string
  source_sha256: string
  source_file_size: number | null
  source_data_source: string | null
  status: 'STAGED' | 'ACTIVE' | 'ARCHIVED'
  procedure_count: number
  transition_count: number
  leg_count: number
  constraint_leg_count: number
  imported_at: string
  imported_by_name: string | null
  imported_by_vid: string
  activated_at: string | null
  activated_by_name: string | null
  activated_by_vid: string | null
}

type ProcedureRow = {
  id: number
  airport: string
  source_approach_id: number
  designator: string
  runway_name: string | null
  arinc_name: string | null
  source_type: string | null
  common_leg_count: number
  transition_count: number
  diff: 'ADDED' | 'CHANGED' | 'UNCHANGED'
}

type TransitionRow = {
  id: number
  procedure_id: number
  source_transition_id: number
  ident: string | null
  source_type: string | null
  leg_count: number
}

type LegRow = {
  id: number
  procedure_id: number
  transition_id: number | null
  leg_kind: 'COMMON' | 'TRANSITION'
  leg_order: number
  path_terminator: string | null
  fix_ident: string | null
  alt_descriptor: string | null
  altitude1_ft: number | null
  altitude2_ft: number | null
  speed_limit_type: string | null
  speed_limit_kt: number | null
  distance_nm: number | null
  course: number | null
}

type DashboardPayload = { cycles: CycleSummary[]; events: Array<Record<string, unknown>> }
type DetailPayload = {
  cycle: CycleSummary
  procedures: ProcedureRow[]
  transitions: TransitionRow[]
  legs: LegRow[]
  diff: { added: number; changed: number; unchanged: number; removed: number; comparedToActive: boolean }
}

type ExtractedProcedure = {
  airport: string
  sourceApproachId: number
  designator: string
  runwayName: string | null
  arincName: string | null
  sourceType: string | null
  sourceSuffix: string | null
  aircraftCategory: string | null
  fingerprint: string
  commonLegCount: number
  transitionCount: number
}

type ExtractedTransition = {
  sourceApproachId: number
  sourceTransitionId: number
  ident: string | null
  sourceType: string | null
  aircraftCategory: string | null
  legCount: number
}

type ExtractedLeg = {
  sourceApproachId: number
  sourceTransitionId: number | null
  legOrder: number
  sourceLegId: number
  pathTerminator: string | null
  arincDescrCode: string | null
  approachFixType: string | null
  turnDirection: string | null
  rnp: number | null
  fixType: string | null
  fixIdent: string | null
  fixRegion: string | null
  fixAirportIdent: string | null
  fixLon: number | null
  fixLat: number | null
  recommendedFixType: string | null
  recommendedFixIdent: string | null
  recommendedFixRegion: string | null
  recommendedFixLon: number | null
  recommendedFixLat: number | null
  isFlyover: boolean
  isTrueCourse: boolean
  course: number | null
  distanceNm: number | null
  legTimeMinutes: number | null
  theta: number | null
  rho: number | null
  altDescriptor: string | null
  altitude1Ft: number | null
  altitude2Ft: number | null
  speedLimitType: string | null
  speedLimitKt: number | null
  verticalAngle: number | null
}

type ExtractedPackage = {
  meta: Record<string, string | number | null>
  procedures: ExtractedProcedure[]
  transitions: ExtractedTransition[]
  legs: ExtractedLeg[]
}

function text(value: unknown) {
  const cleaned = String(value ?? '').trim()
  return cleaned || null
}

function numeric(value: unknown) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function meaningfulAltitude(value: number | null) {
  return value != null && Math.abs(value) > 0.5
}

function hasExtractedConstraint(leg: ExtractedLeg) {
  return meaningfulAltitude(leg.altitude1Ft) || meaningfulAltitude(leg.altitude2Ft) || leg.speedLimitKt != null
}

function hasStoredConstraint(leg: LegRow) {
  return meaningfulAltitude(leg.altitude1_ft) || meaningfulAltitude(leg.altitude2_ft) || leg.speed_limit_kt != null
}

function rows(db: SqlJsDatabase, query: string) {
  const result = db.exec(query)[0]
  if (!result) return [] as Array<Record<string, unknown>>
  return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])))
}

async function loadSqlJs() {
  const windowWithSql = window as WindowSqlJs
  if (!windowWithSql.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-sqljs-loader="true"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Could not load SQLite parser')), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = `${SQLJS_BASE}sql-wasm.js`
      script.async = true
      script.dataset.sqljsLoader = 'true'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load SQLite parser'))
      document.head.appendChild(script)
    })
  }
  if (!windowWithSql.initSqlJs) throw new Error('SQLite parser did not initialize')
  return windowWithSql.initSqlJs({ locateFile: (file) => `${SQLJS_BASE}${file}` })
}

async function sha256Hex(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function legFromRow(
  row: Record<string, unknown>,
  sourceApproachId: number,
  sourceTransitionId: number | null,
  legOrder: number,
  idField: string,
): ExtractedLeg {
  const rawAltitude1 = numeric(row.altitude1)
  const rawAltitude2 = numeric(row.altitude2)
  const hasAltitude = meaningfulAltitude(rawAltitude1) || meaningfulAltitude(rawAltitude2)

  return {
    sourceApproachId,
    sourceTransitionId,
    legOrder,
    sourceLegId: Number(row[idField]),
    pathTerminator: text(row.type),
    arincDescrCode: text(row.arinc_descr_code),
    approachFixType: text(row.approach_fix_type),
    turnDirection: text(row.turn_direction),
    rnp: numeric(row.rnp),
    fixType: text(row.fix_type),
    fixIdent: text(row.fix_ident)?.toUpperCase() ?? null,
    fixRegion: text(row.fix_region),
    fixAirportIdent: text(row.fix_airport_ident)?.toUpperCase() ?? null,
    fixLon: numeric(row.fix_lonx),
    fixLat: numeric(row.fix_laty),
    recommendedFixType: text(row.recommended_fix_type),
    recommendedFixIdent: text(row.recommended_fix_ident)?.toUpperCase() ?? null,
    recommendedFixRegion: text(row.recommended_fix_region),
    recommendedFixLon: numeric(row.recommended_fix_lonx),
    recommendedFixLat: numeric(row.recommended_fix_laty),
    isFlyover: Boolean(Number(row.is_flyover || 0)),
    isTrueCourse: Boolean(Number(row.is_true_course || 0)),
    course: numeric(row.course),
    distanceNm: numeric(row.distance),
    legTimeMinutes: numeric(row.time),
    theta: numeric(row.theta),
    rho: numeric(row.rho),
    altDescriptor: hasAltitude ? text(row.alt_descriptor) : null,
    altitude1Ft: hasAltitude ? rawAltitude1 : null,
    altitude2Ft: hasAltitude ? rawAltitude2 : null,
    speedLimitType: text(row.speed_limit_type),
    speedLimitKt: numeric(row.speed_limit),
    verticalAngle: numeric(row.vertical_angle),
  }
}

async function extractLittleNavmap(file: File, onProgress: (message: string) => void): Promise<ExtractedPackage> {
  if (!/\.sqlite$/i.test(file.name)) throw new Error('Select little_navmap_navigraph.sqlite. Extract the ZIP first.')
  onProgress(`Reading ${(file.size / 1024 / 1024).toFixed(1)} MB SQLite…`)
  const buffer = await file.arrayBuffer()
  const sourceSha256 = await sha256Hex(buffer)
  onProgress('Opening Little Navmap database in browser…')
  const SQL = await loadSqlJs()
  const db = new SQL.Database(new Uint8Array(buffer))

  try {
    const tables = rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((item) => String(item.name))
    for (const required of ['metadata', 'airport', 'approach', 'approach_leg', 'transition', 'transition_leg']) {
      if (!tables.includes(required)) throw new Error(`Unsupported Little Navmap schema: missing ${required}`)
    }

    const metadata = rows(db, 'SELECT * FROM metadata LIMIT 1')[0] || {}
    const cycle = text(metadata.airac_cycle)
    if (!cycle) throw new Error('AIRAC cycle is missing from Little Navmap metadata')

    const dataSource = text(metadata.data_source)?.toUpperCase() || ''
    if (!SUPPORTED_NAVDATA_SOURCES.has(dataSource)) {
      throw new Error(`Unexpected navdata source ${dataSource || 'UNKNOWN'}; expected Navigraph navdata`)
    }

    onProgress(`AIRAC ${cycle}: extracting VTBD / VTBS STAR procedures…`)
    const approachRows = rows(db, `
      SELECT a.*, upper(coalesce(nullif(a.airport_ident,''), ap.ident)) AS airport_code
      FROM approach a
      LEFT JOIN airport ap ON ap.airport_id = a.airport_id
      WHERE upper(coalesce(nullif(a.airport_ident,''), ap.ident)) IN ('VTBD','VTBS')
        AND upper(coalesce(a.suffix,'')) = 'A'
      ORDER BY airport_code, a.fix_ident, a.runway_name, a.approach_id
    `)
    if (!approachRows.length) throw new Error(`AIRAC ${cycle} contains no VTBD/VTBS STAR procedures`)

    const approachIds = approachRows.map((row) => Number(row.approach_id)).filter(Number.isFinite)
    const idList = approachIds.join(',')
    const commonRows = rows(db, `SELECT * FROM approach_leg WHERE approach_id IN (${idList}) AND coalesce(is_missed,0)=0 ORDER BY approach_id, approach_leg_id`)
    const transitionRows = rows(db, `SELECT * FROM transition WHERE approach_id IN (${idList}) ORDER BY approach_id, transition_id`)
    const transitionIds = transitionRows.map((row) => Number(row.transition_id)).filter(Number.isFinite)
    const transitionLegRows = transitionIds.length
      ? rows(db, `SELECT tl.*, t.approach_id FROM transition_leg tl JOIN transition t ON t.transition_id=tl.transition_id WHERE tl.transition_id IN (${transitionIds.join(',')}) ORDER BY t.approach_id, tl.transition_id, tl.transition_leg_id`)
      : []

    const commonByApproach = new Map<number, ExtractedLeg[]>()
    for (const row of commonRows) {
      const approachId = Number(row.approach_id)
      const list = commonByApproach.get(approachId) || []
      list.push(legFromRow(row, approachId, null, list.length + 1, 'approach_leg_id'))
      commonByApproach.set(approachId, list)
    }

    const transitionLegsById = new Map<number, ExtractedLeg[]>()
    for (const row of transitionLegRows) {
      const approachId = Number(row.approach_id)
      const transitionId = Number(row.transition_id)
      const list = transitionLegsById.get(transitionId) || []
      list.push(legFromRow(row, approachId, transitionId, list.length + 1, 'transition_leg_id'))
      transitionLegsById.set(transitionId, list)
    }

    const extractedTransitions: ExtractedTransition[] = transitionRows.map((row) => {
      const transitionId = Number(row.transition_id)
      return {
        sourceApproachId: Number(row.approach_id),
        sourceTransitionId: transitionId,
        ident: text(row.fix_ident)?.toUpperCase() ?? text(row.type),
        sourceType: text(row.type),
        aircraftCategory: text(row.aircraft_category),
        legCount: transitionLegsById.get(transitionId)?.length || 0,
      }
    })

    const transitionsByApproach = new Map<number, ExtractedTransition[]>()
    for (const transition of extractedTransitions) {
      const list = transitionsByApproach.get(transition.sourceApproachId) || []
      list.push(transition)
      transitionsByApproach.set(transition.sourceApproachId, list)
    }

    const allLegs: ExtractedLeg[] = []
    for (const list of commonByApproach.values()) allLegs.push(...list)
    for (const list of transitionLegsById.values()) allLegs.push(...list)

    const procedures: ExtractedProcedure[] = []
    for (const row of approachRows) {
      const approachId = Number(row.approach_id)
      const common = commonByApproach.get(approachId) || []
      const procedureTransitions = transitionsByApproach.get(approachId) || []
      const procedureTransitionLegs = procedureTransitions.flatMap((transition) => transitionLegsById.get(transition.sourceTransitionId) || [])
      const designator = text(row.fix_ident)?.toUpperCase()
      if (!designator) continue

      const canonical = JSON.stringify({
        airport: text(row.airport_code),
        designator,
        runway: text(row.runway_name),
        arinc: text(row.arinc_name),
        type: text(row.type),
        suffix: text(row.suffix),
        common,
        transitions: procedureTransitions,
        transitionLegs: procedureTransitionLegs,
      })

      procedures.push({
        airport: String(row.airport_code),
        sourceApproachId: approachId,
        designator,
        runwayName: text(row.runway_name),
        arincName: text(row.arinc_name),
        sourceType: text(row.type),
        sourceSuffix: text(row.suffix),
        aircraftCategory: text(row.aircraft_category),
        fingerprint: await sha256Hex(new TextEncoder().encode(canonical)),
        commonLegCount: common.length,
        transitionCount: procedureTransitions.length,
      })
    }

    const constraintLegs = allLegs.filter(hasExtractedConstraint).length
    onProgress(`Ready: ${procedures.length} STAR rows · ${extractedTransitions.length} transitions · ${allLegs.length} legs · ${constraintLegs} constrained legs`)

    return {
      meta: {
        cycle,
        validThrough: text(metadata.valid_through),
        sourceKind: 'LITTLE_NAVMAP_NAVIGRAPH',
        sourceFilename: file.name,
        sourceSha256,
        sourceFileSize: file.size,
        dbVersionMajor: numeric(metadata.db_version_major),
        dbVersionMinor: numeric(metadata.db_version_minor),
        dataSource: text(metadata.data_source),
      },
      procedures,
      transitions: extractedTransitions,
      legs: allLegs,
    }
  } finally {
    db.close()
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : value
}

function altitudeLabel(leg: LegRow) {
  if (!meaningfulAltitude(leg.altitude1_ft) && !meaningfulAltitude(leg.altitude2_ft)) return '—'
  const a1 = meaningfulAltitude(leg.altitude1_ft) ? Math.round(Number(leg.altitude1_ft)) : ''
  const a2 = meaningfulAltitude(leg.altitude2_ft) ? Math.round(Number(leg.altitude2_ft)) : ''
  if (leg.alt_descriptor === '+') return `≥ ${a1}`
  if (leg.alt_descriptor === '-') return `≤ ${a1}`
  if (leg.alt_descriptor === 'B') return `${a2}–${a1}`
  if (leg.alt_descriptor === 'A') return `@ ${a1}`
  return `${leg.alt_descriptor || '@'} ${a1 || a2}`
}

function speedLabel(leg: LegRow) {
  if (leg.speed_limit_kt == null) return '—'
  if (leg.speed_limit_type === '+') return `≥ ${leg.speed_limit_kt}`
  if (leg.speed_limit_type === '-') return `≤ ${leg.speed_limit_kt}`
  return `@ ${leg.speed_limit_kt}`
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Admin API returned ${response.status}`)
  return payload as T
}

export default function StaffNavdataAdmin() {
  const user = useAuthUser()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dashboard, setDashboard] = useState<DashboardPayload>({ cycles: [], events: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailPayload | null>(null)
  const [selectedProcedureId, setSelectedProcedureId] = useState<number | null>(null)
  const [candidate, setCandidate] = useState<ExtractedPackage | null>(null)
  const [status, setStatus] = useState('Select little_navmap_navigraph.sqlite to stage a new AIRAC.')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = async () => {
    const payload = await api<DashboardPayload>('/api/admin/navdata')
    setDashboard(payload)
    if (!selectedId && payload.cycles[0]) setSelectedId(payload.cycles[0].id)
  }

  useEffect(() => {
    if (user.isThailandStaff) void loadDashboard().catch((err) => setError(err.message))
  }, [user.isThailandStaff])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void api<DetailPayload>(`/api/admin/navdata?cycle=${encodeURIComponent(selectedId)}`)
      .then((payload) => {
        setDetail(payload)
        setSelectedProcedureId(payload.procedures[0]?.id ?? null)
      })
      .catch((err) => setError(err.message))
  }, [selectedId])

  const selectedProcedure = detail?.procedures.find((item) => item.id === selectedProcedureId) || null
  const procedureTransitions = useMemo(
    () => detail?.transitions.filter((item) => item.procedure_id === selectedProcedureId) || [],
    [detail, selectedProcedureId],
  )
  const procedureLegs = useMemo(
    () => detail?.legs.filter((item) => item.procedure_id === selectedProcedureId) || [],
    [detail, selectedProcedureId],
  )
  const active = dashboard.cycles.find((item) => item.status === 'ACTIVE') || null

  if (!user.isThailandStaff) {
    return <main className="navadmin-denied"><strong>STAFF ACCESS REQUIRED</strong><span>Thailand Division staff only.</span><a href="/">Return to AMAN</a></main>
  }

  const chooseFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setCandidate(null)
    try {
      setCandidate(await extractLittleNavmap(file, setStatus))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Import preparation failed.')
    } finally {
      setBusy(false)
    }
  }

  const importCandidate = async () => {
    if (!candidate) return
    setBusy(true)
    setError(null)
    setStatus(`Uploading AIRAC ${candidate.meta.cycle} structured VTBD/VTBS data…`)
    try {
      const result = await api<{ ok: true; data: { id: string } }>('/api/admin/navdata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', ...candidate }),
      })
      setCandidate(null)
      setStatus('AIRAC staged. Review the diff before activation.')
      await loadDashboard()
      setSelectedId(result.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const activate = async (cycleId: string, cycle: string) => {
    if (!window.confirm(`Activate AIRAC ${cycle}? The current active cycle will be archived.`)) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin/navdata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', cycleId }),
      })
      setStatus(`AIRAC ${cycle} is now ACTIVE.`)
      await loadDashboard()
      setSelectedId(cycleId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (cycleId: string, cycle: string) => {
    if (!window.confirm(`Delete staged/archived AIRAC ${cycle}?`)) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin/navdata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', cycleId }),
      })
      setSelectedId(null)
      setDetail(null)
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return <div className="navadmin-app">
    <header className="navadmin-topbar">
      <div><span>IVAO THAILAND · STAFF</span><strong>AMAN NAVDATA / AIRAC</strong></div>
      <nav><a href="/?admin=tools">← ADMIN TOOLS</a><span>{user.name} · {user.vid}</span><a href="/api/auth/logout">Sign out</a></nav>
    </header>

    <main className="navadmin-main">
      <section className="navadmin-summary-grid">
        <article><span>ACTIVE AIRAC</span><strong>{active?.cycle || 'NONE'}</strong><small>{active ? `${active.procedure_count} STAR · ${active.leg_count} legs` : 'Activate a reviewed cycle'}</small></article>
        <article><span>CONSTRAINT COVERAGE</span><strong>{active?.leg_count ? `${Math.round(active.constraint_leg_count / active.leg_count * 100)}%` : '—'}</strong><small>{active ? `${active.constraint_leg_count}/${active.leg_count} legs carry ALT/SPD data` : 'No active cycle'}</small></article>
        <article><span>STAGED</span><strong>{dashboard.cycles.filter((item) => item.status === 'STAGED').length}</strong><small>Waiting for staff review</small></article>
        <article><span>SOURCE</span><strong>Little Navmap SQLite</strong><small>Only VTBD / VTBS structured procedure data is stored</small></article>
      </section>

      <section className="navadmin-card navadmin-import">
        <div className="navadmin-card-head"><div><span>IMPORT</span><h1>Stage new AIRAC</h1></div><b>{busy ? 'WORKING' : 'STAFF ONLY'}</b></div>
        <p>Use the extracted <code>little_navmap_navigraph.sqlite</code> from the Navigraph Little NavMap manual package. The raw database stays in this browser; only VTBD/VTBS STAR procedure rows and constraints are sent to the AMAN database.</p>
        <input ref={fileRef} hidden type="file" accept=".sqlite,application/vnd.sqlite3" onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseFile(file) }} />
        <div className="navadmin-import-actions">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>SELECT SQLITE</button>
          {candidate && <button type="button" className="primary" disabled={busy} onClick={() => void importCandidate()}>STAGE AIRAC {candidate.meta.cycle}</button>}
          <span>{status}</span>
        </div>
        {candidate && <div className="navadmin-candidate">
          <strong>AIRAC {String(candidate.meta.cycle)}</strong>
          <span>{candidate.procedures.length} STAR rows</span>
          <span>{candidate.transitions.length} transitions</span>
          <span>{candidate.legs.length} legs</span>
          <span>{candidate.legs.filter(hasExtractedConstraint).length} constrained legs</span>
          <small>SHA-256 {String(candidate.meta.sourceSha256).slice(0, 16)}… · source {String(candidate.meta.dataSource)}</small>
        </div>}
        {error && <div className="navadmin-error">{error}</div>}
      </section>

      <div className="navadmin-two-column">
        <section className="navadmin-card">
          <div className="navadmin-card-head"><div><span>HISTORY</span><h2>AIRAC cycles</h2></div></div>
          <div className="navadmin-cycle-list">
            {dashboard.cycles.map((cycle) => <button type="button" key={cycle.id} className={`${selectedId === cycle.id ? 'selected ' : ''}status-${cycle.status.toLowerCase()}`} onClick={() => setSelectedId(cycle.id)}>
              <b>{cycle.cycle}</b><span>{cycle.status}</span><small>{cycle.procedure_count} STAR · {cycle.leg_count} legs · {cycle.constraint_leg_count} constrained</small><em>{formatDate(cycle.imported_at)}</em>
            </button>)}
            {!dashboard.cycles.length && <p>No AIRAC has been imported yet.</p>}
          </div>
        </section>

        <section className="navadmin-card">
          <div className="navadmin-card-head"><div><span>REVIEW</span><h2>{detail ? `AIRAC ${detail.cycle.cycle}` : 'Select a cycle'}</h2></div>{detail && <b className={`status-${detail.cycle.status.toLowerCase()}`}>{detail.cycle.status}</b>}</div>
          {detail && <>
            <div className="navadmin-diff-grid">
              <div><span>ADDED</span><strong>{detail.diff.added}</strong></div>
              <div><span>CHANGED</span><strong>{detail.diff.changed}</strong></div>
              <div><span>REMOVED</span><strong>{detail.diff.removed}</strong></div>
              <div><span>UNCHANGED</span><strong>{detail.diff.unchanged}</strong></div>
            </div>
            <dl className="navadmin-meta">
              <div><dt>File</dt><dd>{detail.cycle.source_filename}</dd></div>
              <div><dt>Imported</dt><dd>{formatDate(detail.cycle.imported_at)} · {detail.cycle.imported_by_name || detail.cycle.imported_by_vid}</dd></div>
              <div><dt>Valid through</dt><dd>{detail.cycle.valid_through || '—'}</dd></div>
              <div><dt>Source</dt><dd>{detail.cycle.source_data_source || '—'}</dd></div>
              <div><dt>SHA-256</dt><dd>{detail.cycle.source_sha256.slice(0, 24)}…</dd></div>
            </dl>
            <div className="navadmin-review-actions">
              {detail.cycle.status !== 'ACTIVE' && <button className="primary" disabled={busy} onClick={() => void activate(detail.cycle.id, detail.cycle.cycle)}>ACTIVATE AIRAC {detail.cycle.cycle}</button>}
              {detail.cycle.status !== 'ACTIVE' && <button className="danger" disabled={busy} onClick={() => void remove(detail.cycle.id, detail.cycle.cycle)}>DELETE</button>}
            </div>
          </>}
        </section>
      </div>

      {detail && <section className="navadmin-card navadmin-procedure-browser">
        <div className="navadmin-card-head"><div><span>PROCEDURE VIEWER</span><h2>STAR legs / constraints</h2></div><b>{detail.procedures.length} PROCEDURES</b></div>
        <div className="navadmin-procedure-layout">
          <div className="navadmin-procedure-list">
            {detail.procedures.map((procedure) => <button type="button" key={procedure.id} className={selectedProcedureId === procedure.id ? 'selected' : ''} onClick={() => setSelectedProcedureId(procedure.id)}>
              <span>{procedure.airport}</span><strong>{procedure.designator}</strong><em>{procedure.runway_name || procedure.arinc_name || 'ALL'}</em><i className={`diff-${procedure.diff.toLowerCase()}`}>{procedure.diff}</i>
            </button>)}
          </div>
          <div className="navadmin-leg-viewer">
            {selectedProcedure ? <>
              <header><div><strong>{selectedProcedure.airport} · {selectedProcedure.designator}</strong><span>RWY {selectedProcedure.runway_name || selectedProcedure.arinc_name || 'ALL'} · {selectedProcedure.source_type || 'STAR'}</span></div><span>{selectedProcedure.common_leg_count} common · {selectedProcedure.transition_count} transitions</span></header>
              {procedureTransitions.length > 0 && <div className="navadmin-transition-strip"><b>TRANSITIONS</b>{procedureTransitions.map((transition) => <span key={transition.id}>{transition.ident || transition.source_type || 'TRANS'} · {transition.leg_count}</span>)}</div>}
              <div className="navadmin-leg-table">
                <div className="head"><span>LEG</span><span>FIX</span><span>PATH</span><span>ALT FT</span><span>SPD KT</span><span>DIST</span></div>
                {procedureLegs.map((leg) => <div key={leg.id} className={hasStoredConstraint(leg) ? 'constrained' : ''}>
                  <span>{leg.leg_kind === 'TRANSITION' ? 'T' : 'C'}{leg.leg_order}</span>
                  <strong>{leg.fix_ident || '—'}</strong>
                  <span>{leg.path_terminator || '—'}</span>
                  <span>{altitudeLabel(leg)}</span>
                  <span>{speedLabel(leg)}</span>
                  <span>{leg.distance_nm == null ? '—' : `${leg.distance_nm.toFixed(1)} NM`}</span>
                </div>)}
              </div>
            </> : <p>Select a STAR.</p>}
          </div>
        </div>
      </section>}
    </main>
  </div>
}
