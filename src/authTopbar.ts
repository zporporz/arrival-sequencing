type AuthUser = {
  vid: string
  name: string
  isThailandStaff: boolean
  staffPositions?: string[]
  staffPositionCodes?: string[]
}

type AuthResponse = {
  authenticated: boolean
  user?: AuthUser
}

const PROFILE_CLASS = 'auth-controller-profile'
let cachedUser: AuthUser | null = null
let loadingUser: Promise<AuthUser | null> | null = null

function makeTextElement(tag: string, className: string, text: string) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  return element
}

function compactStaffPosition(value: string) {
  const original = value.trim()
  if (!original) return 'TH STAFF'
  const upper = original.toUpperCase()
  if (/^TH-[A-Z0-9]{1,10}$/.test(upper)) return upper

  const body = upper.replace(/^TH[-\s]+/, '').replace(/^DIVISION[-\s]+/, '')
  const ignored = new Set(['DIVISION', 'DEPARTMENT', 'STAFF', 'TEAM', 'OF', 'THE'])
  const words = body
    .split(/[\s/_-]+/)
    .map((word) => word.replace(/[^A-Z0-9]/g, ''))
    .filter((word) => word && !ignored.has(word))

  if (words.length === 1 && words[0].length <= 8) return `TH-${words[0]}`
  const acronym = words.map((word) => word[0]).join('').slice(0, 6)
  return acronym ? `TH-${acronym}` : 'TH STAFF'
}

function roleLabel(user: AuthUser) {
  if (!user.isThailandStaff) return 'IVAO MEMBER'
  const apiCodes = [...new Set((user.staffPositionCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean))]
  const fallback = [...new Set((user.staffPositions ?? []).map(compactStaffPosition).filter(Boolean))]
  const codes = apiCodes.length ? apiCodes : fallback
  return codes.length ? codes.join(' / ') : 'TH STAFF'
}

async function loadUser() {
  if (cachedUser) return cachedUser
  if (loadingUser) return loadingUser

  loadingUser = fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return null
      const payload = await response.json() as AuthResponse
      cachedUser = payload.authenticated && payload.user ? payload.user : null
      return cachedUser
    })
    .catch(() => null)
    .finally(() => { loadingUser = null })

  return loadingUser
}

function renderProfile(user: AuthUser, input: HTMLInputElement) {
  input.readOnly = true
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.classList.add('auth-controller-source')

  const actions = input.parentElement
  if (!actions) return

  const role = roleLabel(user)
  let details = actions.querySelector<HTMLDetailsElement>(`.${PROFILE_CLASS}`)

  if (!details) {
    details = document.createElement('details')
    details.className = PROFILE_CLASS

    const summary = document.createElement('summary')
    summary.className = 'auth-controller-summary auth-controller-summary-exact'
    summary.setAttribute('aria-label', 'Open IVAO account menu')

    const labelWrap = document.createElement('span')
    labelWrap.className = 'auth-controller-exact-wrap'
    labelWrap.appendChild(makeTextElement('strong', 'auth-controller-exact-name', user.name))

    const meta = document.createElement('span')
    meta.className = 'auth-controller-exact-meta'
    meta.appendChild(makeTextElement('span', 'auth-controller-exact-role', role))
    meta.appendChild(makeTextElement('span', 'auth-controller-exact-separator', '·'))
    meta.appendChild(makeTextElement('span', 'auth-controller-exact-vid', user.vid))
    meta.appendChild(makeTextElement('span', 'auth-controller-chevron', '▾'))
    labelWrap.appendChild(meta)
    summary.appendChild(labelWrap)
    details.appendChild(summary)

    const menu = document.createElement('div')
    menu.className = 'auth-controller-menu'

    const heading = document.createElement('div')
    heading.className = 'auth-controller-heading'
    heading.appendChild(makeTextElement('strong', 'auth-controller-name', user.name))
    heading.appendChild(makeTextElement('span', 'auth-controller-vid', `VID ${user.vid}`))
    menu.appendChild(heading)

    if (user.isThailandStaff) {
      menu.appendChild(makeTextElement('div', 'auth-controller-role', 'THAILAND DIVISION STAFF'))
      const positions = user.staffPositions ?? []
      if (positions.length) {
        const positionWrap = document.createElement('div')
        positionWrap.className = 'auth-controller-positions'
        for (const position of positions) {
          positionWrap.appendChild(makeTextElement('span', 'auth-controller-position', position))
        }
        menu.appendChild(positionWrap)
      }
    } else {
      menu.appendChild(makeTextElement('div', 'auth-controller-role member', 'IVAO MEMBER'))
    }

    menu.appendChild(makeTextElement('div', 'auth-controller-divider', ''))
    const signOut = document.createElement('a')
    signOut.className = 'auth-controller-signout'
    signOut.href = '/api/auth/logout'
    signOut.textContent = 'Sign out of IVAO'
    menu.appendChild(signOut)
    details.appendChild(menu)

    const addFlightButton = actions.querySelector('.primary-button')
    actions.insertBefore(details, addFlightButton ?? null)

    document.addEventListener('click', (event) => {
      if (!details?.open) return
      const target = event.target
      if (target instanceof Node && !details.contains(target)) details.open = false
    })
  } else {
    const name = details.querySelector<HTMLElement>('.auth-controller-exact-name')
    const roleNode = details.querySelector<HTMLElement>('.auth-controller-exact-role')
    const vid = details.querySelector<HTMLElement>('.auth-controller-exact-vid')
    if (name) name.textContent = user.name
    if (roleNode) roleNode.textContent = role
    if (vid) vid.textContent = user.vid
  }
}

async function buildProfile() {
  const input = document.querySelector<HTMLInputElement>('input.controller-name')
  if (!input) return
  const user = await loadUser()
  if (!user) return
  renderProfile(user, input)
}

export function installAuthTopbar() {
  let frame = 0
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() => { void buildProfile() })
  }

  const start = () => {
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    window.setInterval(schedule, 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
