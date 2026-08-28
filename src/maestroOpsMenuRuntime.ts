type ReactRowProps = {
  onDoubleClick?: () => void
}

type RowIdentity = {
  airport: 'VTBD' | 'VTBS'
  callsign: string
  runway: string
  demo: boolean
}

type IvaoFlight = {
  callsign?: string
  aircraft?: string | null
  departure?: string | null
  arrival?: string | null
  route?: string | null
  state?: string | null
  altitude?: number | null
  verticalSpeedFpm?: number | null
  groundSpeed?: number | null
  filedCruiseAltitudeFt?: number | null
}

type IvaoTrafficPayload = {
  flights?: IvaoFlight[]
}

const MENU_CLASS = 'aman-runtime-ops-menu'
const MODAL_CLASS = 'aman-runtime-info-modal'

function reactProps<T>(element: Element): T | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  if (!key) return null
  return (element as unknown as Record<string, unknown>)[key] as T
}

function rowIdentity(row: HTMLElement): RowIdentity | null {
  const title = row.getAttribute('title') || ''
  const callsign = row.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
  const airport = title.includes('VTBS RWY') ? 'VTBS' : title.includes('VTBD RWY') ? 'VTBD' : null
  const runway = title.match(/(?:VTBD|VTBS) RWY\s+([0-9A-Z]+)/i)?.[1]?.toUpperCase()
    || row.querySelector<HTMLSelectElement>('.runway-assignment select')?.value?.toUpperCase()
    || row.querySelector<HTMLElement>('.runway-assignment')?.textContent?.trim().toUpperCase()
    || '----'
  return airport && callsign ? { airport, callsign, runway, demo: row.classList.contains('is-demo') } : null
}

function rowText(row: HTMLElement, index: number) {
  return row.children.item(index)?.textContent?.trim() || '----'
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = '') {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.textContent = text
  return node
}

function infoItem(label: string, value: string, wide = false) {
  const item = document.createElement('div')
  if (wide) item.className = 'wide'
  item.append(textElement('span', label), textElement('strong', value))
  return item
}

function closeMenu() {
  document.querySelector(`.${MENU_CLASS}`)?.remove()
}

function closeInfo() {
  document.querySelector(`.${MODAL_CLASS}`)?.remove()
}

function button(label: string, onClick: () => void, options: { danger?: boolean; disabled?: boolean; title?: string } = {}) {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (options.danger) node.classList.add('is-danger')
  if (options.disabled) node.disabled = true
  if (options.title) node.title = options.title
  node.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!node.disabled) onClick()
  })
  return node
}

function section(label: string) {
  const node = document.createElement('div')
  node.className = 'aman-runtime-ops-section'
  node.textContent = label
  return node
}

async function writeOperationalAction(identity: RowIdentity, action: string, extra: Record<string, unknown> = {}) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      action,
      serviceDate: new Date().toISOString().slice(0, 10),
      airport: identity.airport,
      callsign: identity.callsign,
      ...extra,
    }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error || `AMAN API returned ${response.status}`)
}

function applyRunway(row: HTMLElement, runway: string) {
  const select = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (!select) return
  select.value = runway
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function showMessage(text: string) {
  let toast = document.querySelector<HTMLElement>('.aman-runtime-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'aman-runtime-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = text
  toast.classList.add('is-visible')
  window.setTimeout(() => toast?.classList.remove('is-visible'), 2200)
}

function formatNumber(value: number | null | undefined, suffix = '') {
  return Number.isFinite(value) ? `${Math.round(Number(value))}${suffix}` : '----'
}

async function fetchLiveFlight(identity: RowIdentity) {
  if (identity.demo) return null
  try {
    const response = await fetch(`/api/sequence/ivao-traffic?airport=${identity.airport}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = await response.json() as IvaoTrafficPayload
    return (payload.flights || []).find((flight) => String(flight.callsign || '').trim().toUpperCase() === identity.callsign) || null
  } catch {
    return null
  }
}

async function showInformation(row: HTMLElement, identity: RowIdentity) {
  closeMenu()
  closeInfo()

  const overlay = document.createElement('div')
  overlay.className = MODAL_CLASS
  const panel = document.createElement('div')
  panel.className = 'aman-runtime-info-panel'
  const header = document.createElement('header')
  const heading = document.createElement('div')
  heading.append(
    textElement('span', identity.demo ? 'TEST TRAFFIC' : 'LIVE TRAFFIC'),
    textElement('strong', identity.callsign),
  )
  const close = textElement('button', '×')
  close.type = 'button'
  close.setAttribute('aria-label', 'Close')
  header.append(heading, close)
  panel.append(header, textElement('div', 'Loading flight information…', 'aman-runtime-info-loading'))
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  panel.querySelector('header button')?.addEventListener('click', closeInfo)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeInfo() })

  const live = await fetchLiveFlight(identity)
  if (!document.body.contains(panel)) return

  const title = row.getAttribute('title') || ''
  const etaFf = title.match(/ETA-FF\s+(\d{2}:\d{2}(?::\d{2})?)/i)?.[1] || '----'
  const tldt = rowText(row, 0)
  const aircraft = rowText(row, 2)
  const iAwp = rowText(row, 3)
  const tto = rowText(row, 4)
  const tdly = rowText(row, 5).split(/\s+/)[0] || '----'

  panel.querySelector('.aman-runtime-info-loading')?.remove()
  const body = document.createElement('div')
  body.className = 'aman-runtime-info-grid'
  body.append(
    infoItem('Airport / Runway', `${identity.airport} / ${identity.runway}`),
    infoItem('Aircraft', aircraft),
    infoItem('IAWP', iAwp),
    infoItem('ETA-FF', `${etaFf}Z`),
    infoItem('STA / TLDT', `${tldt}Z`),
    infoItem('STA-FF / TTO', `${tto}Z`),
    infoItem('TDLY', `${tdly} min`),
    infoItem('Status', identity.demo ? 'SIMULATED' : (live?.state || 'LIVE')),
    infoItem('Altitude', formatNumber(live?.altitude, ' ft')),
    infoItem('Ground Speed', formatNumber(live?.groundSpeed, ' kt')),
    infoItem('Vertical Speed', formatNumber(live?.verticalSpeedFpm, ' fpm')),
    infoItem('Filed Cruise', formatNumber(live?.filedCruiseAltitudeFt, ' ft')),
    infoItem('Route', live?.route || (identity.demo ? 'SIMULATED TEST ROUTE' : '----'), true),
  )
  panel.appendChild(body)
}

function recompute(identity: RowIdentity) {
  closeMenu()
  showMessage(`${identity.airport}: recomputing ${identity.demo ? 'test' : 'live'} traffic…`)
  window.dispatchEvent(new CustomEvent('aman:recompute-airport', {
    detail: { airport: identity.airport, demo: identity.demo },
  }))
}

function returnAuto(row: HTMLElement) {
  closeMenu()
  reactProps<ReactRowProps>(row)?.onDoubleClick?.()
}

function buildMenu(row: HTMLElement, identity: RowIdentity, x: number, y: number) {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = MENU_CLASS
  menu.style.left = `${Math.min(x, window.innerWidth - 270)}px`
  menu.style.top = `${Math.min(y, window.innerHeight - 560)}px`

  const header = document.createElement('header')
  header.append(
    textElement('strong', identity.callsign),
    textElement('span', `${identity.airport} · RWY ${identity.runway}${identity.demo ? ' · TEST' : ''}`),
  )
  menu.appendChild(header)

  menu.appendChild(section('FLIGHT'))
  menu.appendChild(button('Information', () => void showInformation(row, identity)))
  menu.appendChild(button(identity.demo ? `Recompute ${identity.airport} Test Traffic` : `Recompute ${identity.airport}`, () => recompute(identity)))
  menu.appendChild(button('Return to AUTO', () => returnAuto(row)))

  const runwaySelect = row.querySelector<HTMLSelectElement>('.runway-assignment select')
  if (runwaySelect && runwaySelect.options.length > 1) {
    menu.appendChild(section('CHANGE RUNWAY'))
    Array.from(runwaySelect.options).forEach((option) => {
      const suffix = option.value === runwaySelect.value ? ' ✓' : ''
      menu.appendChild(button(`${option.value}${suffix}`, () => { applyRunway(row, option.value); closeMenu() }))
    })
  }

  menu.appendChild(section('SEQUENCE'))
  const liveOnlyTitle = identity.demo ? 'Visible in TEST mode, but database-changing action is disabled for simulated traffic.' : undefined
  const liveOnly = identity.demo

  menu.appendChild(button('Missed Approach', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalState', { operationalState: 'MISSED_APPROACH' })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { disabled: liveOnly, title: liveOnlyTitle }))
  menu.appendChild(button('Desequence', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalState', { operationalState: 'DESEQUENCED' })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { disabled: liveOnly, title: liveOnlyTitle }))
  menu.appendChild(button('Insert Gap +1 min', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalGap', { reservedGapSeconds: 60 })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { disabled: liveOnly, title: liveOnlyTitle }))
  menu.appendChild(button('Insert Gap +2 min', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalGap', { reservedGapSeconds: 120 })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { disabled: liveOnly, title: liveOnlyTitle }))
  menu.appendChild(button('Clear Reserved Gap', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalGap', { reservedGapSeconds: 0 })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { disabled: liveOnly, title: liveOnlyTitle }))
  menu.appendChild(button('Remove from Sequence', () => {
    closeMenu()
    void writeOperationalAction(identity, 'setOperationalState', { operationalState: 'REMOVED' })
      .catch((error) => showMessage(error instanceof Error ? error.message : String(error)))
  }, { danger: true, disabled: liveOnly, title: liveOnlyTitle }))

  const note = document.createElement('small')
  note.textContent = identity.demo
    ? 'TEST mode is isolated: read/recompute/runway/AUTO tools work; live database actions are shown but locked.'
    : 'Shared operational changes are written to the AMAN workspace and propagate to other controllers.'
  menu.appendChild(note)

  document.body.appendChild(menu)
}

export function installMaestroOpsMenuRuntime() {
  const onContextMenu = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.target.closest('select')) return
    const row = event.target.closest<HTMLElement>('.aman-flight-row')
    if (!row) return
    const identity = rowIdentity(row)
    if (!identity) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    buildMenu(row, identity, event.clientX, event.clientY)
  }

  const onPointerDown = (event: PointerEvent) => {
    const menu = document.querySelector(`.${MENU_CLASS}`)
    if (menu && event.target instanceof Node && !menu.contains(event.target)) closeMenu()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeMenu()
      closeInfo()
    }
  }

  const onRecomputeFinished = (event: Event) => {
    const detail = (event as CustomEvent<{ airport?: string; ok?: boolean; error?: string | null; demo?: boolean }>).detail
    if (!detail?.airport) return
    showMessage(detail.ok
      ? `${detail.airport}: ${detail.demo ? 'test traffic' : 'ETA / sequence'} recomputed`
      : `${detail.airport}: recompute failed${detail.error ? ` · ${detail.error}` : ''}`)
  }

  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('aman:airport-recompute-finished', onRecomputeFinished)

  return () => {
    closeMenu()
    closeInfo()
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('aman:airport-recompute-finished', onRecomputeFinished)
    document.querySelector('.aman-runtime-toast')?.remove()
  }
}
