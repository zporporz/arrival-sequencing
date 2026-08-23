type AirportCode = 'VTBD' | 'VTBS'

const DIRECT_INSERT_OFFSET_MS = 10 * 60_000

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

function formatHm(ms: number) {
  const date = new Date(ms)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

async function postAman(body: Record<string, unknown>) {
  const response = await fetch('/api/sequence/aman-state', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ serviceDate: new Date().toISOString().slice(0, 10), ...body }),
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || `AMAN API returned ${response.status}`)
}

async function dismissLanded(airport: AirportCode, callsign: string) {
  const response = await fetch('/api/sequence/landed-history', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'dismissLanded', airport, callsign }),
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || `Landed history API returned ${response.status}`)
}

function activeMenuIdentity(menu: HTMLElement) {
  const callsign = menu.querySelector('header strong')?.textContent?.trim().toUpperCase() || ''
  const meta = menu.querySelector('header span')?.textContent?.trim().toUpperCase() || ''
  const airport = meta.match(/\b(VTBD|VTBS)\b/)?.[1] as AirportCode | undefined
  const runway = meta.match(/\bRWY\s+([0-9A-Z]+)/)?.[1] || null
  return airport && callsign && runway ? { airport, callsign, runway } : null
}

function landedMenuIdentity(menu: HTMLElement) {
  const callsign = menu.querySelector('header strong')?.textContent?.trim().toUpperCase() || ''
  const meta = menu.querySelector('header span')?.textContent?.trim().toUpperCase() || ''
  const airport = meta.match(/\b(VTBD|VTBS)\b/)?.[1] as AirportCode | undefined
  if (!airport || !callsign) return null

  const row = Array.from(document.querySelectorAll<HTMLElement>('.aman-landed-history-row')).find((candidate) => {
    const rowCallsign = candidate.querySelector('strong')?.textContent?.trim().toUpperCase() || ''
    return rowCallsign === callsign
  })
  const runway = row?.querySelector('em')?.textContent?.trim().toUpperCase() || null
  return runway ? { airport, callsign, runway } : null
}

async function directInsert(airport: AirportCode, callsign: string, runway: string, fromLanded: boolean) {
  const targetMs = Date.now() + DIRECT_INSERT_OFFSET_MS
  await postAman({
    action: 'setMissedApproachTarget',
    airport,
    callsign,
    manualTldt: new Date(targetMs).toISOString(),
    manualRunway: runway,
  })
  if (fromLanded) await dismissLanded(airport, callsign)
  showMessage(`${callsign}: GA/MISSED inserted ${formatHm(targetMs)}Z (+10M)`)

  // Shared-state/traffic poll will materialize the row. Prompt an immediate refresh of
  // the shared state without reloading the whole page.
  window.dispatchEvent(new CustomEvent('aman:force-shared-refresh'))
}

export function installMissedApproachDirectInsertRuntime() {
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('.aman-runtime-ops-menu button')
    if (!button) return
    const label = (button.textContent || '').trim().toUpperCase()

    const landedMenu = button.closest<HTMLElement>('.aman-landed-stage-menu')
    const isLandedGa = Boolean(landedMenu && label.startsWith('GO AROUND / MISSED'))
    const isActiveMissed = !landedMenu && label === 'MISSED APPROACH'
    if (!isLandedGa && !isActiveMissed) return

    const identity = landedMenu ? landedMenuIdentity(landedMenu) : activeMenuIdentity(button.closest<HTMLElement>('.aman-runtime-ops-menu')!)
    if (!identity) return

    // Own this action completely. Do not let the legacy handler first move the flight
    // into MISSED queue; direct-insert is now the single operational flow.
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    button.disabled = true

    void directInsert(identity.airport, identity.callsign, identity.runway, Boolean(landedMenu))
      .then(() => button.closest('.aman-runtime-ops-menu')?.remove())
      .catch((error) => {
        button.disabled = false
        showMessage(error instanceof Error ? error.message : String(error))
      })
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
