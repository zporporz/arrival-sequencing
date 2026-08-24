import { getAuthenticatedIdentity, getBrowserIdentity } from './browserIdentity'

type OnlineController = {
  key: string
  displayName: string
  vid: string | null
  roleLabel: string | null
  staffPositions: string[]
  onlineAt: string | null
  airportView: string | null
}

function currentAirportView() {
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('.aman-airport-scope-picker input[type="checkbox"]:checked'))
    .map((input) => input.value.trim().toUpperCase())
    .filter(Boolean)
  if (checked.length) return checked.join(' + ')

  const active = Array.from(document.querySelectorAll<HTMLButtonElement>('.aman-airport-tabs > button'))
    .find((button) => button.classList.contains('is-active'))
  return active?.textContent?.trim().toUpperCase() || 'AMAN'
}

function sinceLabel(value: string | null) {
  if (!value) return 'ONLINE'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'ONLINE'
  return `SINCE ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}Z`
}

function ensurePresenceMenu() {
  const session = document.querySelector<HTMLElement>('.aman-session')
  if (!session) return null

  let menu = session.querySelector<HTMLDetailsElement>('.aman-online-menu')
  if (menu) return menu

  menu = document.createElement('details')
  menu.className = 'aman-online-menu'
  const summary = document.createElement('summary')
  const indicator = document.createElement('i')
  const summaryCount = document.createElement('strong')
  summaryCount.textContent = '1 ONLINE'
  summary.append(indicator, summaryCount)

  const popover = document.createElement('div')
  popover.className = 'aman-online-popover'
  const heading = document.createElement('div')
  heading.className = 'aman-online-heading'
  const headingCopy = document.createElement('div')
  const headingTitle = document.createElement('b')
  headingTitle.textContent = 'Controllers online'
  const headingSubtitle = document.createElement('span')
  headingSubtitle.textContent = 'AMAN website'
  headingCopy.append(headingTitle, headingSubtitle)
  const headingCount = document.createElement('strong')
  headingCount.textContent = '1'
  heading.append(headingCopy, headingCount)
  const list = document.createElement('div')
  list.className = 'aman-online-list'
  const note = document.createElement('small')
  note.textContent = 'Live presence from this Arrival Sequencing website.'
  popover.append(heading, list, note)
  menu.append(summary, popover)

  const signout = session.querySelector('.aman-signout')
  if (signout) session.insertBefore(menu, signout)
  else session.appendChild(menu)
  return menu
}

function renderPresence(controllers: OnlineController[]) {
  const menu = ensurePresenceMenu()
  if (!menu) return

  const count = Math.max(1, controllers.length)
  const summaryCount = menu.querySelector<HTMLElement>('summary strong')
  const headingCount = menu.querySelector<HTMLElement>('.aman-online-heading > strong')
  const list = menu.querySelector<HTMLElement>('.aman-online-list')
  if (summaryCount) summaryCount.textContent = `${count} ONLINE`
  if (headingCount) headingCount.textContent = String(count)
  if (!list) return

  const items = controllers.map((controller) => {
    const initials = controller.displayName.slice(0, 2).toUpperCase()
    const meta = [
      controller.roleLabel,
      controller.vid ? `VID ${controller.vid}` : null,
      controller.airportView,
    ].filter(Boolean).join(' · ')
    const staffDetail = controller.staffPositions.length ? controller.staffPositions.join(' / ') : ''
    const item = document.createElement('div')
    item.className = 'aman-online-item'
    const avatar = document.createElement('i')
    avatar.textContent = initials
    const copy = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = controller.displayName
    const details = document.createElement('span')
    details.textContent = meta
    copy.append(name, details)
    if (staffDetail) {
      const staff = document.createElement('small')
      staff.textContent = staffDetail
      copy.appendChild(staff)
    }
    const since = document.createElement('em')
    since.textContent = sinceLabel(controller.onlineAt)
    item.append(avatar, copy, since)
    return item
  })
  list.replaceChildren(...items)
}

export function installOnlinePresenceRuntime() {
  const browser = getBrowserIdentity()
  const authenticated = getAuthenticatedIdentity()
  const startedAt = new Date().toISOString()
  const roleLabel = authenticated?.isThailandStaff ? 'TH STAFF' : 'IVAO MEMBER'
  const displayName = authenticated?.name?.trim() || authenticated?.displayName?.trim() || browser.displayName
  const vid = authenticated?.vid || null
  const staffPositions = authenticated?.staffPositions ?? []

  let disposed = false
  let lastScope = ''

  const syncPresence = async () => {
    if (disposed) return
    try {
      const response = await fetch('/api/sequence/presence', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json() as { controllers?: OnlineController[]; error?: string }
      if (!response.ok) throw new Error(payload.error || `Presence API returned ${response.status}`)
      const controllers = payload.controllers || []
      if (!controllers.length) controllers.push({
        key: vid || browser.id,
        displayName,
        vid,
        roleLabel,
        staffPositions,
        onlineAt: startedAt,
        airportView: currentAirportView(),
      })
      if (!disposed) renderPresence(controllers)
    } catch {
      if (!disposed) renderPresence([{
        key: vid || browser.id,
        displayName,
        vid,
        roleLabel,
        staffPositions,
        onlineAt: startedAt,
        airportView: currentAirportView(),
      }])
    }
  }

  const track = async () => {
    if (disposed) return
    const airportView = currentAirportView()
    lastScope = airportView
    const response = await fetch('/api/sequence/presence', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'track',
        browserId: browser.id,
        displayName,
        onlineAt: startedAt,
        airportView,
      }),
    })
    if (!response.ok) throw new Error(`Presence API returned ${response.status}`)
  }

  ensurePresenceMenu()
  renderPresence([{ key: vid || browser.id, displayName, vid, roleLabel, staffPositions, onlineAt: startedAt, airportView: currentAirportView() }])
  void track().then(syncPresence).catch(() => void syncPresence())

  const scopeTimer = window.setInterval(() => {
    ensurePresenceMenu()
    const scope = currentAirportView()
    if (scope !== lastScope) void track().then(syncPresence).catch(() => {})
  }, 2_000)
  const heartbeatTimer = window.setInterval(() => void track().catch(() => {}), 10_000)
  const presenceTimer = window.setInterval(() => void syncPresence(), 5_000)

  return () => {
    disposed = true
    window.clearInterval(scopeTimer)
    window.clearInterval(heartbeatTimer)
    window.clearInterval(presenceTimer)
    document.querySelector('.aman-online-menu')?.remove()
    void fetch('/api/sequence/presence', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'leave', browserId: browser.id }),
    }).catch(() => {})
  }
}
