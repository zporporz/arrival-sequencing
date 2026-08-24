import { TIMELINE_DISPLAY_PX_PER_MINUTE, TIMELINE_LOGICAL_PX_PER_MINUTE } from './timelineScale'

type AirportCode = 'VTBD' | 'VTBS'
type DisplaySide = 'LEFT' | 'RIGHT'
type LandedRecord = {
  airport: AirportCode
  callsign: string
  raw_session_id?: string | null
  aircraft_type: string | null
  landed_at: string
  snapshot?: Record<string, unknown>
}

type Payload = { flights?: LandedRecord[] }

type FakePointerEvent = {
  button: number
  preventDefault: () => void
  currentTarget: {
    setPointerCapture: (pointerId: number) => void
    hasPointerCapture: (pointerId: number) => boolean
    releasePointerCapture: (pointerId: number) => void
  }
  pointerId: number
  clientY: number
}

type ReactRowProps = {
  onPointerDown?: (event: FakePointerEvent) => void
  onPointerMove?: (event: FakePointerEvent) => void
  onPointerUp?: (event: FakePointerEvent) => void
}

const STORAGE_KEY = 'aman-airport-display-sides-v1'
const LIVE_POLL_MS = 15_000
const RENDER_MS = 1_000
const LANDED_MENU_CLASS = 'aman-landed-stage-menu'
const MISSED_APPROACH_OFFSET_MS = 10 * 60_000
const POINTER_ID = 70425

const testLandedByKey = new Map<string, LandedRecord>()
const testMissedByKey = new Set<string>()
const lastRunwayByKey = new Map<string, string>()

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function fakePointer(clientY: number): FakePointerEvent {
  return {
    button: 0,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    },
    pointerId: POINTER_ID,
    clientY,
  }
}

function testTrafficEnabled() {
  return document.querySelector('.aman-demo-toggle.is-active') != null
}

function selectedAirports(): AirportCode[] {
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.aman-airport-scope-picker input[type="checkbox"]:checked'))
    .map((input) => input.value.trim().toUpperCase())
    .filter((value): value is AirportCode => value === 'VTBD' || value === 'VTBS')
  if (checked.length) return checked
  return ['VTBD']
}

function historyMinutes() {
  const value = Number(document.querySelector<HTMLSelectElement>('.aman-history-control select')?.value)
  return Number.isFinite(value) ? value : 10
}

function readDisplaySides() {
  const fallback: Record<AirportCode, DisplaySide> = { VTBD: 'LEFT', VTBS: 'RIGHT' }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Record<AirportCode, DisplaySide>>
    return {
      VTBD: parsed.VTBD === 'RIGHT' ? 'RIGHT' : 'LEFT',
      VTBS: parsed.VTBS === 'LEFT' ? 'LEFT' : 'RIGHT',
    } satisfies Record<AirportCode, DisplaySide>
  } catch {
    return fallback
  }
}

function formatHm(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--:--'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function parseClockNearNow(value: string, nowMs: number) {
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const now = new Date(nowMs)
  const candidate = new Date(now)
  candidate.setUTCHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0)
  const delta = candidate.getTime() - nowMs
  if (delta < -12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() + 1)
  if (delta > 12 * 60 * 60 * 1000) candidate.setUTCDate(candidate.getUTCDate() - 1)
  return candidate.getTime()
}

function testRowAirport(row: HTMLElement): AirportCode | null {
  const title = row.getAttribute('title') || ''
  if (title.includes('VTBD RWY')) return 'VTBD'
  if (title.includes('VTBS RWY')) return 'VTBS'
  return null
}

function testRowTldtMs(row: HTMLElement, nowMs: number) {
  const frozenIso = row.dataset.frozenTldt
  if (frozenIso) {
    const value = new Date(frozenIso).getTime()
    if (Number.isFinite(value)) return value
  }

  const title = row.getAttribute('title') || ''
  const clock = title.match(/STA\/TLDT\s+(\d{2}:\d{2}(?::\d{2})?)Z/i)?.[1]
  return clock ? parseClockNearNow(clock, nowMs) : null
}

function testRowRunway(row: HTMLElement) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (select?.value) return select.value.trim().toUpperCase()
  const text = row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase() || ''
  return text.match(/(?:BD\/|BS\/)?(21R|21L|19|20L|20R)/)?.[1] || null
}

function rememberActiveRunways() {
  document.querySelectorAll<HTMLElement>('.aman-flight-row:not(.is-demo)').forEach((row) => {
    const airport = testRowAirport(row)
    const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    const runway = testRowRunway(row)
    if (airport && callsign && runway) lastRunwayByKey.set(`${airport}:${callsign}`, runway)
  })
}

function findTestFlightRow(record: LandedRecord) {
  return Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row.is-demo')).find((row) =>
    testRowAirport(row) === record.airport
      && row.querySelector('strong')?.textContent?.trim().toUpperCase() === record.callsign,
  ) ?? null
}

function applyTestTarget(row: HTMLElement, targetMs: number) {
  const currentMs = testRowTldtMs(row, Date.now())
  const props = reactProps<ReactRowProps>(row)
  if (currentMs == null || !props?.onPointerDown || !props.onPointerMove || !props.onPointerUp) return false
  const deltaMinutes = (targetMs - currentMs) / 60_000
  const y = -deltaMinutes * TIMELINE_LOGICAL_PX_PER_MINUTE
  props.onPointerDown(fakePointer(0))
  props.onPointerMove(fakePointer(y))
  props.onPointerUp(fakePointer(y))
  return true
}

function collectTestLandings(nowMs: number) {
  document.querySelectorAll<HTMLElement>('.aman-flight-row.is-demo').forEach((row) => {
    const airport = testRowAirport(row)
    const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    if (!airport || !callsign) return

    const key = `${airport}:${callsign}`
    if (testMissedByKey.has(key)) {
      delete row.dataset.testLanded
      return
    }

    const existing = testLandedByKey.get(key)
    if (existing) {
      row.dataset.testLanded = 'true'
      return
    }

    const targetMs = testRowTldtMs(row, nowMs)
    if (targetMs == null || targetMs > nowMs) {
      delete row.dataset.testLanded
      return
    }

    const landedAt = new Date(nowMs).toISOString()
    const aircraft = row.children.item(2)?.textContent?.trim().toUpperCase() || null
    const runway = testRowRunway(row)
    testLandedByKey.set(key, {
      airport,
      callsign,
      aircraft_type: aircraft,
      landed_at: landedAt,
      snapshot: {
        source: 'TEST_TRAFFIC',
        state: 'TEST_LANDED',
        plannedTldt: new Date(targetMs).toISOString(),
        runway,
      },
    })
    row.dataset.testLanded = 'true'
  })
}

function clearTestLandings() {
  testLandedByKey.clear()
  testMissedByKey.clear()
  document.querySelectorAll<HTMLElement>('.aman-flight-row[data-test-landed]').forEach((row) => {
    delete row.dataset.testLanded
    delete row.dataset.testMissedApproach
  })
}

function closeLandedMenu() {
  document.querySelector(`.${LANDED_MENU_CLASS}`)?.remove()
}

function showToast(message: string) {
  let toast = document.querySelector<HTMLElement>('.aman-runtime-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'aman-runtime-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.classList.add('is-visible')
  window.setTimeout(() => toast?.classList.remove('is-visible'), 2200)
}

function missedTargetMs(record: LandedRecord) {
  const landedMs = new Date(record.landed_at).getTime()
  return (Number.isFinite(landedMs) ? landedMs : Date.now()) + MISSED_APPROACH_OFFSET_MS
}

async function writeMissedApproach(record: LandedRecord) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      action: 'setOperationalState',
      serviceDate: new Date().toISOString().slice(0, 10),
      airport: record.airport,
      callsign: record.callsign,
      operationalState: 'MISSED_APPROACH',
    }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `AMAN API returned ${response.status}`)
}

async function dismissLiveLanded(record: LandedRecord) {
  const response = await fetch('/api/sequence/landed-history', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'dismissLanded', airport: record.airport, callsign: record.callsign }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Landed history API returned ${response.status}`)
}

function handleGoAround(record: LandedRecord, liveRecords: LandedRecord[], setLiveRecords: (rows: LandedRecord[]) => void) {
  closeLandedMenu()
  const key = `${record.airport}:${record.callsign}`
  const isTest = String(record.snapshot?.source || '') === 'TEST_TRAFFIC'
  const targetMs = missedTargetMs(record)

  if (isTest) {
    const row = findTestFlightRow(record)
    testLandedByKey.delete(key)
    testMissedByKey.add(key)
    if (row) {
      delete row.dataset.testLanded
      row.dataset.testMissedApproach = 'true'
      applyTestTarget(row, targetMs)
    }
    showToast(`${record.callsign}: TEST MISSED · TLDT ${formatHm(new Date(targetMs).toISOString())}Z (+10M)`)
    return
  }

  void (async () => {
    try {
      await writeMissedApproach(record)
      await dismissLiveLanded(record)
      setLiveRecords(liveRecords.filter((row) => !(row.airport === record.airport && row.callsign === record.callsign)))
      showToast(`${record.callsign}: MISSED APPROACH · awaiting REINSERT`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    }
  })()
}

function openLandedMenu(record: LandedRecord, x: number, y: number, liveRecords: LandedRecord[], setLiveRecords: (rows: LandedRecord[]) => void) {
  closeLandedMenu()
  const menu = document.createElement('div')
  menu.className = `${LANDED_MENU_CLASS} aman-runtime-ops-menu`
  menu.style.left = `${Math.min(x, window.innerWidth - 270)}px`
  menu.style.top = `${Math.min(y, window.innerHeight - 260)}px`

  const header = document.createElement('header')
  const headerCallsign = document.createElement('strong')
  headerCallsign.textContent = record.callsign
  const headerStatus = document.createElement('span')
  headerStatus.textContent = `${record.airport} · LANDED · ALDT ${formatHm(record.landed_at)}Z`
  header.append(headerCallsign, headerStatus)
  menu.appendChild(header)

  const section = document.createElement('div')
  section.className = 'aman-runtime-ops-section'
  section.textContent = 'LANDED STAGE'
  menu.appendChild(section)

  const ga = document.createElement('button')
  ga.type = 'button'
  ga.textContent = 'GO AROUND / MISSED APPROACH'
  ga.addEventListener('click', (event) => {
    event.stopPropagation()
    handleGoAround(record, liveRecords, setLiveRecords)
  })
  menu.appendChild(ga)

  const note = document.createElement('small')
  note.textContent = 'Live GA recovery requires the same IVAO session, a fresh airborne climb track and a known assigned runway.'
  menu.appendChild(note)
  document.body.appendChild(menu)
}

function buildRow(record: LandedRecord, side: DisplaySide, nowMs: number, liveRecords: LandedRecord[], setLiveRecords: (rows: LandedRecord[]) => void) {
  const landedMs = new Date(record.landed_at).getTime()
  const row = document.createElement('div')
  row.className = 'aman-landed-history-row'
  row.dataset.landedKey = `${record.airport}:${record.callsign}:${record.landed_at}`
  row.dataset.landedAirport = record.airport
  row.dataset.landedAt = record.landed_at
  row.dataset.displaySide = side
  row.dataset.flightStatus = 'LANDED'
  row.dataset.landedSource = String(record.snapshot?.source || 'LIVE')
  const rawSessionId = String(record.raw_session_id || record.snapshot?.sessionId || '').trim()
  if (rawSessionId) row.dataset.landedSessionId = rawSessionId
  row.style.setProperty('--landed-offset-px', `${Math.round((nowMs - landedMs) / 60_000 * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
  row.title = `LANDED · ${record.airport} · ${record.callsign} · ALDT ${formatHm(record.landed_at)}Z · click/right-click for actions`

  const aldt = document.createElement('span')
  aldt.className = 'tldt'
  aldt.textContent = formatHm(record.landed_at)
  const callsign = document.createElement('strong')
  callsign.textContent = record.callsign
  const aircraft = document.createElement('span')
  aircraft.textContent = record.aircraft_type || '----'
  const fix = document.createElement('span')
  fix.className = 'fix-code'
  fix.textContent = 'L'
  const actual = document.createElement('span')
  actual.textContent = formatHm(record.landed_at)
  const state = document.createElement('b')
  state.textContent = 'ALDT'
  const runway = document.createElement('em')
  const rememberedRunway = lastRunwayByKey.get(`${record.airport}:${record.callsign}`)
  runway.textContent = String(record.snapshot?.runway || rememberedRunway || (record.snapshot?.source === 'TEST_TRAFFIC' ? 'TEST' : 'LANDED'))
  row.append(aldt, callsign, aircraft, fix, actual, state, runway)

  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openLandedMenu(record, event.clientX, event.clientY, liveRecords, setLiveRecords)
  }
  row.addEventListener('click', open)
  row.addEventListener('contextmenu', open)
  return row
}

export function installLandedHistoryRuntime() {
  let disposed = false
  let liveRecords: LandedRecord[] = []
  let previousTestMode = false
  const setLiveRecords = (rows: LandedRecord[]) => { liveRecords = rows; render() }

  const currentRecords = () => testTrafficEnabled()
    ? [...testLandedByKey.values()]
    : liveRecords

  const render = () => {
    if (disposed) return
    const testMode = testTrafficEnabled()
    const nowMs = Date.now()
    rememberActiveRunways()

    if (testMode) {
      if (!previousTestMode) liveRecords = []
      collectTestLandings(nowMs)
    } else if (previousTestMode) {
      clearTestLandings()
    }
    previousTestMode = testMode

    const layer = document.querySelector<HTMLElement>('.aman-flight-layer')
    if (!layer) return
    const cutoffMs = nowMs - historyMinutes() * 60_000
    const sides = readDisplaySides()
    const visible = currentRecords().filter((record) => {
      const landedMs = new Date(record.landed_at).getTime()
      return Number.isFinite(landedMs) && landedMs >= cutoffMs && landedMs <= nowMs
    })
    const keys = new Set(visible.map((record) => `${record.airport}:${record.callsign}:${record.landed_at}`))

    layer.querySelectorAll<HTMLElement>('.aman-landed-history-row').forEach((row) => {
      if (!keys.has(row.dataset.landedKey || '')) row.remove()
    })

    for (const record of visible) {
      const key = `${record.airport}:${record.callsign}:${record.landed_at}`
      let row = layer.querySelector<HTMLElement>(`.aman-landed-history-row[data-landed-key="${CSS.escape(key)}"]`)
      if (!row) {
        row = buildRow(record, sides[record.airport], nowMs, liveRecords, setLiveRecords)
        layer.appendChild(row)
      }
      row.dataset.displaySide = sides[record.airport]
      const landedMs = new Date(record.landed_at).getTime()
      row.style.setProperty('--landed-offset-px', `${Math.round((nowMs - landedMs) / 60_000 * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
    }
  }

  const refreshLive = async () => {
    if (disposed || testTrafficEnabled()) return
    const airports = selectedAirports()
    const results = await Promise.all(airports.map(async (airport) => {
      try {
        const response = await fetch(`/api/sequence/landed-history?airport=${airport}`, {
          credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
        })
        if (!response.ok) return []
        const payload = await response.json() as Payload
        return payload.flights || []
      } catch {
        return []
      }
    }))
    if (disposed || testTrafficEnabled()) return
    liveRecords = results.flat()
    render()
  }

  const closeOnOutside = (event: PointerEvent) => {
    const menu = document.querySelector(`.${LANDED_MENU_CLASS}`)
    if (menu && event.target instanceof Node && !menu.contains(event.target)) closeLandedMenu()
  }

  document.addEventListener('pointerdown', closeOnOutside, true)
  void refreshLive()
  render()
  const poll = window.setInterval(() => void refreshLive(), LIVE_POLL_MS)
  const renderTimer = window.setInterval(render, RENDER_MS)

  return () => {
    disposed = true
    window.clearInterval(poll)
    window.clearInterval(renderTimer)
    document.removeEventListener('pointerdown', closeOnOutside, true)
    closeLandedMenu()
    clearTestLandings()
    lastRunwayByKey.clear()
    document.querySelectorAll('.aman-landed-history-row').forEach((row) => row.remove())
  }
}
