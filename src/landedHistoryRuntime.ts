import { TIMELINE_DISPLAY_PX_PER_MINUTE } from './timelineScale'

type AirportCode = 'VTBD' | 'VTBS'
type DisplaySide = 'LEFT' | 'RIGHT'
type LandedRecord = {
  airport: AirportCode
  callsign: string
  aircraft_type: string | null
  landed_at: string
  snapshot?: Record<string, unknown>
}

type Payload = { flights?: LandedRecord[] }

const STORAGE_KEY = 'aman-airport-display-sides-v1'
const LIVE_POLL_MS = 15_000
const RENDER_MS = 1_000

const testLandedByKey = new Map<string, LandedRecord>()

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

function collectTestLandings(nowMs: number) {
  const activeKeys = new Set<string>()

  document.querySelectorAll<HTMLElement>('.aman-flight-row.is-demo').forEach((row) => {
    const airport = testRowAirport(row)
    const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    if (!airport || !callsign) return

    const key = `${airport}:${callsign}`
    activeKeys.add(key)
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

    // TEST TRAFFIC has no IVAO terminal-state sensor. Crossing TLDT creates one
    // synthetic terminal observation so the same first-observation ALDT freeze and
    // landed-history rendering can be exercised without touching production data.
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

  document.querySelectorAll<HTMLElement>('.aman-flight-row.is-demo[data-test-landed]').forEach((row) => {
    const airport = testRowAirport(row)
    const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    if (!airport || !callsign || !testLandedByKey.has(`${airport}:${callsign}`)) {
      delete row.dataset.testLanded
    }
  })

  // Records remain frozen for the configured history window even after the active
  // synthetic row disappears. They are cleared only when TEST TRAFFIC is switched off.
  void activeKeys
}

function clearTestLandings() {
  testLandedByKey.clear()
  document.querySelectorAll<HTMLElement>('.aman-flight-row[data-test-landed]').forEach((row) => {
    delete row.dataset.testLanded
  })
}

function buildRow(record: LandedRecord, side: DisplaySide, nowMs: number) {
  const landedMs = new Date(record.landed_at).getTime()
  const row = document.createElement('div')
  row.className = 'aman-landed-history-row'
  row.dataset.landedKey = `${record.airport}:${record.callsign}:${record.landed_at}`
  row.dataset.displaySide = side
  row.dataset.landedSource = String(record.snapshot?.source || 'LIVE')
  row.style.setProperty('--landed-offset-px', `${Math.round((nowMs - landedMs) / 60_000 * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
  row.title = `LANDED · ${record.airport} · ${record.callsign} · ALDT ${formatHm(record.landed_at)}Z · FIRST OBSERVED`

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
  runway.textContent = String(record.snapshot?.runway || (record.snapshot?.source === 'TEST_TRAFFIC' ? 'TEST' : 'LANDED'))
  row.append(aldt, callsign, aircraft, fix, actual, state, runway)
  return row
}

export function installLandedHistoryRuntime() {
  let disposed = false
  let liveRecords: LandedRecord[] = []
  let previousTestMode = false

  const currentRecords = () => testTrafficEnabled()
    ? [...testLandedByKey.values()]
    : liveRecords

  const render = () => {
    if (disposed) return
    const testMode = testTrafficEnabled()
    const nowMs = Date.now()

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
        row = buildRow(record, sides[record.airport], nowMs)
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

  void refreshLive()
  render()
  const poll = window.setInterval(() => void refreshLive(), LIVE_POLL_MS)
  const renderTimer = window.setInterval(render, RENDER_MS)

  return () => {
    disposed = true
    window.clearInterval(poll)
    window.clearInterval(renderTimer)
    clearTestLandings()
    document.querySelectorAll('.aman-landed-history-row').forEach((row) => row.remove())
  }
}
