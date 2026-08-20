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
const POLL_MS = 15_000

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

function buildRow(record: LandedRecord, side: DisplaySide, nowMs: number) {
  const landedMs = new Date(record.landed_at).getTime()
  const row = document.createElement('div')
  row.className = 'aman-landed-history-row'
  row.dataset.landedKey = `${record.airport}:${record.callsign}:${record.landed_at}`
  row.dataset.displaySide = side
  row.style.setProperty('--landed-offset-px', `${Math.round((nowMs - landedMs) / 60_000 * TIMELINE_DISPLAY_PX_PER_MINUTE * 100) / 100}px`)
  row.title = `LANDED · ${record.airport} · ${record.callsign} · ALDT ${formatHm(record.landed_at)}Z`

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
  runway.textContent = 'LANDED'
  row.append(aldt, callsign, aircraft, fix, actual, state, runway)
  return row
}

export function installLandedHistoryRuntime() {
  let disposed = false
  let records: LandedRecord[] = []

  const render = () => {
    if (disposed) return
    const layer = document.querySelector<HTMLElement>('.aman-flight-layer')
    if (!layer) return
    const nowMs = Date.now()
    const cutoffMs = nowMs - historyMinutes() * 60_000
    const sides = readDisplaySides()
    const visible = records.filter((record) => {
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

  const refresh = async () => {
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
    if (disposed) return
    records = results.flat()
    render()
  }

  void refresh()
  const poll = window.setInterval(() => void refresh(), POLL_MS)
  const renderTimer = window.setInterval(render, 1000)

  return () => {
    disposed = true
    window.clearInterval(poll)
    window.clearInterval(renderTimer)
    document.querySelectorAll('.aman-landed-history-row').forEach((row) => row.remove())
  }
}
