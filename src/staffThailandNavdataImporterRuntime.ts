const SQLJS_VERSION = '1.13.0'
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`

type SqlResult = { columns: string[]; values: unknown[][] }
type SqlDb = { exec: (sql: string) => SqlResult[]; close: () => void }
type SqlStatic = { Database: new (data: Uint8Array) => SqlDb }
type SqlWindow = Window & { initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlStatic> }
type Row = Record<string, unknown>

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

type Package = {
  meta: Record<string, string | number | null>
  procedures: Array<Record<string, unknown>>
  transitions: Array<Record<string, unknown>>
  legs: ExtractedLeg[]
}

function text(value: unknown) {
  const result = String(value ?? '').trim()
  return result || null
}

function numeric(value: unknown) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function meaningfulAltitude(value: number | null) {
  return value != null && Math.abs(value) > 0.5
}

function rows(db: SqlDb, sql: string) {
  const result = db.exec(sql)[0]
  if (!result) return [] as Row[]
  return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])))
}

async function loadSqlJs() {
  const win = window as SqlWindow
  if (!win.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-sqljs-loader="true"]')
      if (existing) {
        if (win.initSqlJs) return resolve()
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
  if (!win.initSqlJs) throw new Error('SQLite parser did not initialize')
  return win.initSqlJs({ locateFile: (file) => `${SQLJS_BASE}${file}` })
}

async function sha256Hex(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function legFromRow(row: Row, approachId: number, transitionId: number | null, order: number, idField: string): ExtractedLeg {
  const altitude1 = numeric(row.altitude1)
  const altitude2 = numeric(row.altitude2)
  const hasAltitude = meaningfulAltitude(altitude1) || meaningfulAltitude(altitude2)
  return {
    sourceApproachId: approachId,
    sourceTransitionId: transitionId,
    legOrder: order,
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
    altitude1Ft: hasAltitude ? altitude1 : null,
    altitude2Ft: hasAltitude ? altitude2 : null,
    speedLimitType: text(row.speed_limit_type),
    speedLimitKt: numeric(row.speed_limit),
    verticalAngle: numeric(row.vertical_angle),
  }
}

async function extractThailand(file: File, setStatus: (message: string) => void): Promise<Package> {
  if (!/\.sqlite$/i.test(file.name)) throw new Error('Select little_navmap_navigraph.sqlite')
  setStatus(`Reading ${(file.size / 1024 / 1024).toFixed(1)} MB SQLite…`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  setStatus('Checking SQLite file…')
  const sourceSha256 = await sha256Hex(bytes)
  setStatus('Opening SQLite database…')
  const SQL = await loadSqlJs()
  const db = new SQL.Database(bytes)

  try {
    const metadata = rows(db, 'SELECT * FROM metadata LIMIT 1')[0] || {}
    const cycle = text(metadata.airac_cycle)
    if (!cycle) throw new Error('AIRAC cycle missing from metadata')
    const source = text(metadata.data_source)?.toUpperCase()
    if (source !== 'NG' && source !== 'NAVIGRAPH') throw new Error(`Unexpected navdata source ${source || 'UNKNOWN'}`)

    setStatus(`AIRAC ${cycle}: extracting all Thailand STAR procedures…`)
    const approachRows = rows(db, `
      SELECT a.*, upper(coalesce(nullif(a.airport_ident,''), ap.ident)) AS airport_code
      FROM approach a
      LEFT JOIN airport ap ON ap.airport_id = a.airport_id
      WHERE upper(coalesce(nullif(a.airport_ident,''), ap.ident)) LIKE 'VT%'
        AND upper(coalesce(a.suffix,'')) = 'A'
      ORDER BY airport_code, a.fix_ident, a.runway_name, a.approach_id
    `)
    if (!approachRows.length) throw new Error(`AIRAC ${cycle} contains no Thailand STAR procedures`)

    const approachIds = approachRows.map((row) => Number(row.approach_id)).filter(Number.isFinite)
    const ids = approachIds.join(',')
    const commonRows = rows(db, `SELECT * FROM approach_leg WHERE approach_id IN (${ids}) AND coalesce(is_missed,0)=0 ORDER BY approach_id, approach_leg_id`)
    const transitionRows = rows(db, `SELECT * FROM transition WHERE approach_id IN (${ids}) ORDER BY approach_id, transition_id`)
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

    const transitions = transitionRows.map((row) => {
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

    const transitionsByApproach = new Map<number, typeof transitions>()
    for (const transition of transitions) {
      const list = transitionsByApproach.get(transition.sourceApproachId) || []
      list.push(transition)
      transitionsByApproach.set(transition.sourceApproachId, list)
    }

    const legs: ExtractedLeg[] = []
    for (const list of commonByApproach.values()) legs.push(...list)
    for (const list of transitionLegsById.values()) legs.push(...list)

    const procedures: Array<Record<string, unknown>> = []
    for (const row of approachRows) {
      const approachId = Number(row.approach_id)
      const designator = text(row.fix_ident)?.toUpperCase()
      if (!designator) continue
      const common = commonByApproach.get(approachId) || []
      const procedureTransitions = transitionsByApproach.get(approachId) || []
      const transitionLegs = procedureTransitions.flatMap((transition) => transitionLegsById.get(transition.sourceTransitionId) || [])
      const canonical = new TextEncoder().encode(JSON.stringify({
        airport: text(row.airport_code),
        designator,
        runway: text(row.runway_name),
        arinc: text(row.arinc_name),
        type: text(row.type),
        suffix: text(row.suffix),
        common,
        transitions: procedureTransitions,
        transitionLegs,
      }))
      procedures.push({
        airport: text(row.airport_code)?.toUpperCase(),
        sourceApproachId: approachId,
        designator,
        runwayName: text(row.runway_name),
        arincName: text(row.arinc_name),
        sourceType: text(row.type),
        sourceSuffix: text(row.suffix),
        aircraftCategory: text(row.aircraft_category),
        fingerprint: await sha256Hex(canonical),
        commonLegCount: common.length,
        transitionCount: procedureTransitions.length,
      })
    }

    const airports = new Set(procedures.map((procedure) => String(procedure.airport)))
    const constrained = legs.filter((leg) => meaningfulAltitude(leg.altitude1Ft) || meaningfulAltitude(leg.altitude2Ft) || leg.speedLimitKt != null).length
    setStatus(`Ready: ${airports.size} airports · ${procedures.length} STAR · ${transitions.length} transitions · ${legs.length} legs · ${constrained} constrained`)

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
      transitions,
      legs,
    }
  } finally {
    db.close()
  }
}

async function postPackage(pkg: Package) {
  const response = await fetch('/api/admin/navdata', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import', ...pkg }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Admin API returned ${response.status}`)
}

function showRuntimeError(message: string, container: HTMLElement | null) {
  let box = document.querySelector<HTMLElement>('.navadmin-runtime-error')
  if (!box) {
    box = document.createElement('div')
    box.className = 'navadmin-error navadmin-runtime-error'
    container?.appendChild(box)
  }
  box.textContent = message
}

export function installStaffThailandNavdataImporterRuntime() {
  if (new URLSearchParams(window.location.search).get('admin') !== 'navdata') return () => {}

  let disposed = false
  let busy = false
  let candidate: Package | null = null
  let retryTimer = 0
  let selectButton: HTMLButtonElement | null = null
  let stageButton: HTMLButtonElement | null = null
  let actions: HTMLElement | null = null
  const originalButtons: Array<{ element: HTMLButtonElement; display: string }> = []

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.sqlite,application/vnd.sqlite3'
  input.hidden = true
  document.body.appendChild(input)

  const statusText = () => actions?.querySelector<HTMLSpanElement>('span') || null
  const setStatus = (message: string) => {
    const status = statusText()
    if (status) status.textContent = message
  }

  const installUi = () => {
    if (disposed) return true
    actions = document.querySelector<HTMLElement>('.navadmin-import-actions')
    if (!actions) return false

    actions.querySelectorAll<HTMLButtonElement>('[data-thailand-importer]').forEach((element) => element.remove())
    for (const button of Array.from(actions.querySelectorAll<HTMLButtonElement>('button'))) {
      originalButtons.push({ element: button, display: button.style.display })
      button.style.display = 'none'
    }

    selectButton = document.createElement('button')
    selectButton.type = 'button'
    selectButton.dataset.thailandImporter = 'select'
    selectButton.textContent = 'SELECT SQLITE · ALL THAILAND'
    selectButton.onclick = () => { if (!busy) input.click() }
    actions.prepend(selectButton)

    stageButton = document.createElement('button')
    stageButton.type = 'button'
    stageButton.className = 'primary'
    stageButton.dataset.thailandImporter = 'stage'
    stageButton.style.display = 'none'
    stageButton.onclick = async () => {
      if (!candidate || busy) return
      busy = true
      selectButton!.disabled = true
      stageButton!.disabled = true
      setStatus(`Uploading AIRAC ${candidate.meta.cycle} · all Thailand STAR data…`)
      try {
        await postPackage(candidate)
        candidate = null
        setStatus('AIRAC staged. Reloading…')
        window.location.reload()
      } catch (error) {
        showRuntimeError(error instanceof Error ? error.message : String(error), actions?.parentElement || null)
        selectButton!.disabled = false
        stageButton!.disabled = false
        busy = false
      }
    }
    actions.appendChild(stageButton)

    const copy = document.querySelector<HTMLElement>('.navadmin-import p')
    if (copy) {
      const filename = document.createElement('code')
      filename.textContent = 'little_navmap_navigraph.sqlite'
      const scope = document.createElement('strong')
      scope.textContent = 'STAR data for all Thailand airports (VT**)'
      copy.replaceChildren(
        document.createTextNode('Use '),
        filename,
        document.createTextNode('. The raw SQLite stays in this browser; structured '),
        scope,
        document.createTextNode(' is staged for staff review.'),
      )
    }
    const sourceSmall = document.querySelector<HTMLElement>('.navadmin-summary-grid > article:nth-child(4) small')
    if (sourceSmall) sourceSmall.textContent = 'All Thailand VT** STAR procedures are stored'
    return true
  }

  const tryInstall = (attempt = 0) => {
    if (disposed || installUi()) return
    if (attempt >= 40) return
    retryTimer = window.setTimeout(() => tryInstall(attempt + 1), 50)
  }

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file || busy) return
    busy = true
    candidate = null
    document.querySelector('.navadmin-runtime-error')?.remove()
    if (selectButton) selectButton.disabled = true
    if (stageButton) stageButton.style.display = 'none'

    try {
      candidate = await extractThailand(file, setStatus)
      if (stageButton) {
        stageButton.textContent = `STAGE AIRAC ${candidate.meta.cycle} · THAILAND`
        stageButton.style.display = ''
        stageButton.disabled = false
      }
    } catch (error) {
      setStatus('Import preparation failed.')
      showRuntimeError(error instanceof Error ? error.message : String(error), actions?.parentElement || null)
    } finally {
      busy = false
      if (selectButton) selectButton.disabled = false
      input.value = ''
    }
  }

  tryInstall()

  return () => {
    disposed = true
    if (retryTimer) window.clearTimeout(retryTimer)
    selectButton?.remove()
    stageButton?.remove()
    for (const { element, display } of originalButtons) element.style.display = display
    input.remove()
  }
}
