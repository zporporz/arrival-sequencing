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
const FLOATING_PROFILE_ID = 'auth-controller-floating-profile'
let cachedUser: AuthUser | null = null
let loadingUser: Promise<AuthUser | null> | null = null
let outsideClickBound = false

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

function positionProfile(input: HTMLInputElement, details: HTMLDetailsElement) {
  const rect = input.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  details.style.left = `${Math.round(rect.left)}px`
  details.style.top = `${Math.round(rect.top + Math.max(0, (rect.height - details.offsetHeight) / 2))}px`
}

function createProfile(user: AuthUser) {
  const details = document.createElement('details')
  details.id = FLOATING_PROFILE_ID
  details.className = `${PROFILE_CLASS} auth-controller-floating`

  const summary = document.createElement('summary')
  summary.className = 'auth-controller-summary auth-controller-summary-exact'
  summary.setAttribute('aria-label', 'Open IVAO account menu')

  const labelWrap = document.createElement('span')
  labelWrap.className = 'auth-controller-exact-wrap'
  labelWrap.appendChild(makeTextElement('strong', 'auth-controller-exact-name', user.name))

  const meta = document.createElement('span')
  meta.className = 'auth-controller-exact-meta'
  meta.appendChild(makeTextElement('span', 'auth-controller-exact-role', roleLabel(user)))
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

    const adminLink = document.createElement('a')
    adminLink.className = 'auth-controller-signout auth-controller-admin-link'
    adminLink.href = '/admin'
    adminLink.textContent = 'Open Admin Console'
    menu.appendChild(makeTextElement('div', 'auth-controller-divider', ''))
    menu.appendChild(adminLink)
  } else {
    menu.appendChild(makeTextElement('div', 'auth-controller-role member', 'IVAO MEMBER'))
    menu.appendChild(makeTextElement('div', 'auth-controller-divider', ''))
  }

  const signOut = document.createElement('a')
  signOut.className = 'auth-controller-signout'
  signOut.href = '/api/auth/logout'
  signOut.textContent = 'Sign out of IVAO'
  menu.appendChild(signOut)
  details.appendChild(menu)

  document.body.appendChild(details)
  return details
}

function updateProfile(details: HTMLDetailsElement, user: AuthUser) {
  const name = details.querySelector<HTMLElement>('.auth-controller-exact-name')
  const role = details.querySelector<HTMLElement>('.auth-controller-exact-role')
  const vid = details.querySelector<HTMLElement>('.auth-controller-exact-vid')
  if (name) name.textContent = user.name
  if (role) role.textContent = roleLabel(user)
  if (vid) vid.textContent = user.vid
}

async function buildProfile() {
  const input = document.querySelector<HTMLInputElement>('input.controller-name')
  if (!input) return

  input.disabled = true
  input.readOnly = true
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.classList.add('auth-controller-anchor')

  const user = await loadUser()
  if (!user) return

  let details = document.getElementById(FLOATING_PROFILE_ID) as HTMLDetailsElement | null
  if (!details) details = createProfile(user)
  else updateProfile(details, user)

  positionProfile(input, details)

  if (!outsideClickBound) {
    outsideClickBound = true
    document.addEventListener('click', (event) => {
      const profile = document.getElementById(FLOATING_PROFILE_ID) as HTMLDetailsElement | null
      if (!profile?.open) return
      const target = event.target
      if (target instanceof Node && !profile.contains(target)) profile.open = false
    })
  }
}

export function installAuthTopbar() {
  const schedule = () => { void buildProfile() }

  const start = () => {
    schedule()
    window.setInterval(schedule, 500)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
