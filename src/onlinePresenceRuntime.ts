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

function safeText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

function ensurePresenceMenu() {
  const session = document.querySelector<HTMLElement>('.aman-session')
  if (!session) return null

  let menu = session.querySelector<HTMLDetailsElement>('.aman-online-menu')
  if (menu) return menu

  menu = document.createElement('details')
  menu.className = 'aman-online-menu'
  menu.innerHTML = `
    <summary><i></i><strong>1 ONLINE</strong></summary>
    <div class="aman-online-popover">
      <div class="aman-online-heading"><div><b>Controllers online</b><span>AMAN website</span></div><strong>1</strong></div>
      <div class="aman-online-list"></div>
      <small>Live presence from this Arrival Sequencing website.</small>
    </div>
  `

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

  list.innerHTML = controllers.map((controller) => {
    const initials = controller.displayName.slice(0, 2).toUpperCase()
    const meta = [
      controller.roleLabel,
      controller.vid ? `VID ${controller.vid}` : null,
      controller.airportView,
    ].filter(Boolean).join(' · ')
    const staffDetail = controller.staffPositions.length ? controller.staffPositions.join(' / ') : ''
    return `
      <div class="aman-online-item">
        <i>${safeText(initials)}</i>
        <div><strong>${safeText(controller.displayName)}</strong><span>${safeText(meta)}</span>${staffDetail ? `<small>${safeText(staffDetail)}</small>` : ''}</div>
        <em>${safeText(sinceLabel(controller.onlineAt))}</em>
      </div>
    `
  }).join('')
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
