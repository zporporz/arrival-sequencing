const TIME_COLUMNS = {
  eto: 5,
  eldt: 6,
  cldt: 7,
  cto: 8,
} as const

const ROLE_DEFINITIONS = [
  [TIME_COLUMNS.eto, 'INPUT', 'Enter the estimated time over the reference fix.'],
  [TIME_COLUMNS.eldt, 'ESTIMATE', 'Automatically calculated estimated landing time.'],
  [TIME_COLUMNS.cldt, 'SEQUENCE', 'Starts at ELDT; controller may override for sequencing.'],
  [TIME_COLUMNS.cto, 'TARGET', 'Automatically calculated target time over the reference fix.'],
] as const

function parseClock(value: string) {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function normalizedDelta(target: number, baseline: number) {
  let delta = target - baseline
  if (delta > 720) delta -= 1440
  if (delta < -720) delta += 1440
  return delta
}

function signedMinutes(minutes: number) {
  if (minutes > 0) return `+${minutes}m`
  if (minutes < 0) return `${minutes}m`
  return '0m'
}

function cellClock(cell: HTMLTableCellElement | undefined) {
  if (!cell) return null
  const input = cell.querySelector<HTMLInputElement>('input.cell-input.time')
  return parseClock(input?.value ?? cell.textContent ?? '')
}

function clearRowState(row: HTMLTableRowElement) {
  row.classList.remove('sequence-adjusted-row', 'timing-mismatch-row')
  for (const index of Object.values(TIME_COLUMNS)) {
    const cell = row.cells[index]
    if (!cell) continue
    cell.classList.remove('time-role-input-cell', 'time-role-estimate-cell', 'time-role-sequence-cell', 'time-role-target-cell', 'sequence-adjusted-cell', 'timing-mismatch-cell')
    cell.removeAttribute('data-time-state')
    cell.removeAttribute('data-time-delta')
    cell.querySelector('.sequence-adjustment-badge')?.remove()
  }
}

function addBadge(cell: HTMLTableCellElement, label: string, kind: 'adjusted' | 'mismatch') {
  let badge = cell.querySelector<HTMLSpanElement>('.sequence-adjustment-badge')
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'sequence-adjustment-badge'
    cell.appendChild(badge)
  }
  badge.classList.toggle('mismatch', kind === 'mismatch')
  badge.textContent = label
}

function applyRowRoles(row: HTMLTableRowElement) {
  row.cells[TIME_COLUMNS.eto]?.classList.add('time-role-input-cell')
  row.cells[TIME_COLUMNS.eldt]?.classList.add('time-role-estimate-cell')
  row.cells[TIME_COLUMNS.cldt]?.classList.add('time-role-sequence-cell')
  row.cells[TIME_COLUMNS.cto]?.classList.add('time-role-target-cell')
}

function evaluateRow(row: HTMLTableRowElement) {
  if (row.cells.length < 10) return
  clearRowState(row)
  applyRowRoles(row)

  const eto = cellClock(row.cells[TIME_COLUMNS.eto])
  const eldt = cellClock(row.cells[TIME_COLUMNS.eldt])
  const cldt = cellClock(row.cells[TIME_COLUMNS.cldt])
  const cto = cellClock(row.cells[TIME_COLUMNS.cto])
  if ([eto, eldt, cldt, cto].some((value) => value === null)) return

  const landingDelta = normalizedDelta(cldt!, eldt!)
  const fixDelta = normalizedDelta(cto!, eto!)
  const cldtCell = row.cells[TIME_COLUMNS.cldt]
  const ctoCell = row.cells[TIME_COLUMNS.cto]

  if (landingDelta === 0 && fixDelta === 0) {
    cldtCell.dataset.timeState = 'AUTO'
    ctoCell.dataset.timeState = 'MATCHED'
    return
  }

  if (landingDelta === fixDelta) {
    row.classList.add('sequence-adjusted-row')
    cldtCell.classList.add('sequence-adjusted-cell')
    ctoCell.classList.add('sequence-adjusted-cell')
    cldtCell.dataset.timeState = 'OVERRIDE'
    ctoCell.dataset.timeState = 'TARGET ADJUSTED'
    cldtCell.dataset.timeDelta = signedMinutes(landingDelta)
    ctoCell.dataset.timeDelta = signedMinutes(fixDelta)
    cldtCell.title = `TLDT differs from ELDT by ${signedMinutes(landingDelta)}. This is an active sequence adjustment.`
    ctoCell.title = `CTO differs from ETO by ${signedMinutes(fixDelta)} to achieve the adjusted TLDT.`
    addBadge(ctoCell, `SEQUENCE ${signedMinutes(landingDelta)}`, 'adjusted')
    return
  }

  row.classList.add('timing-mismatch-row')
  for (const index of Object.values(TIME_COLUMNS)) row.cells[index]?.classList.add('timing-mismatch-cell')
  cldtCell.dataset.timeState = 'CHECK'
  ctoCell.dataset.timeState = 'MISMATCH'
  cldtCell.title = `Landing adjustment is ${signedMinutes(landingDelta)}, but target-fix adjustment is ${signedMinutes(fixDelta)}.`
  ctoCell.title = 'ETO/CTO and ELDT/TLDT adjustments do not agree. Check timing.'
  addBadge(ctoCell, '⚠ TIMING MISMATCH', 'mismatch')
}

function installHeaderRoles() {
  const headers = document.querySelectorAll<HTMLTableCellElement>('table thead th')
  if (headers.length < 9) return

  for (const [index, role, description] of ROLE_DEFINITIONS) {
    const header = headers[index]
    if (!header) continue
    header.classList.add('time-role-header', `time-role-${role.toLowerCase()}`)
    header.title = description
    if (!header.querySelector('.time-role-chip')) {
      const chip = document.createElement('span')
      chip.className = 'time-role-chip'
      chip.textContent = role
      header.appendChild(chip)
    }
  }
}

function installWorkflowStrip() {
  const toolbar = document.querySelector('.workspace-toolbar > div:first-child')
  if (!toolbar || toolbar.querySelector('.time-workflow-strip')) return

  const strip = document.createElement('div')
  strip.className = 'time-workflow-strip'
  strip.innerHTML = `
    <span><b>ETO</b><small>INPUT</small></span>
    <i>→</i>
    <span><b>ELDT</b><small>AUTO ESTIMATE</small></span>
    <i>→</i>
    <span><b>TLDT</b><small>SEQUENCE</small></span>
    <i>→</i>
    <span><b>CTO</b><small>AUTO TARGET</small></span>
  `
  toolbar.appendChild(strip)
}

function refresh() {
  installHeaderRoles()
  installWorkflowStrip()
  document.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(evaluateRow)
}

export function installTimeWorkflow() {
  let frame = 0
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(refresh)
  }

  const start = () => {
    schedule()
    document.addEventListener('input', schedule, true)
    document.addEventListener('change', schedule, true)
    document.addEventListener('focusout', schedule, true)

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] })

    window.setInterval(schedule, 500)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
