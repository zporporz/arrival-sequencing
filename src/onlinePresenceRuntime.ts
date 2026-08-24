import { getAuthenticatedIdentity, getBrowserIdentity } from './browserIdentity'
import { supabase } from './lib/supabase'

type PresenceMeta = {
  displayName?: string
  vid?: string
  roleLabel?: string
  staffPositions?: string[]
  onlineAt?: string
  airportView?: string
}

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

  const channel = supabase.channel('aman:web-online:v1', {
    config: { presence: { key: browser.id } },
  })

  let disposed = false
  let lastScope = ''

  const syncPresence = () => {
    const state = channel.presenceState<PresenceMeta>()
    const byController = new Map<string, OnlineController>()

    for (const presence of Object.values(state).flat()) {
      if (!presence.displayName) continue
      const key = presence.vid?.trim() || presence.displayName.trim().toUpperCase()
      const candidate: OnlineController = {
        key,
        displayName: presence.displayName,
        vid: presence.vid?.trim() || null,
        roleLabel: presence.roleLabel?.trim() || null,
        staffPositions: Array.isArray(presence.staffPositions) ? presence.staffPositions.filter(Boolean) : [],
        onlineAt: presence.onlineAt || null,
        airportView: presence.airportView?.trim() || null,
      }
      const current = byController.get(key)
      if (!current || (candidate.onlineAt && (!current.onlineAt || candidate.onlineAt < current.onlineAt))) {
        byController.set(key, candidate)
      }
    }

    const controllers = [...byController.values()].sort((left, right) => left.displayName.localeCompare(right.displayName))
    if (!controllers.length) {
      controllers.push({
        key: vid || browser.id,
        displayName,
        vid,
        roleLabel,
        staffPositions,
        onlineAt: startedAt,
        airportView: currentAirportView(),
      })
    }
    renderPresence(controllers)
  }

  const track = async () => {
    if (disposed) return
    const airportView = currentAirportView()
    lastScope = airportView
    await channel.track({
      displayName,
      vid: vid || undefined,
      roleLabel,
      staffPositions,
      onlineAt: startedAt,
      airportView,
    })
  }

  channel
    .on('presence', { event: 'sync' }, syncPresence)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await track()
        syncPresence()
      }
    })

  ensurePresenceMenu()
  renderPresence([{ key: vid || browser.id, displayName, vid, roleLabel, staffPositions, onlineAt: startedAt, airportView: currentAirportView() }])

  const scopeTimer = window.setInterval(() => {
    ensurePresenceMenu()
    const scope = currentAirportView()
    if (scope !== lastScope) void track()
  }, 2_000)

  return () => {
    disposed = true
    window.clearInterval(scopeTimer)
    document.querySelector('.aman-online-menu')?.remove()
    void supabase.removeChannel(channel)
  }
}
