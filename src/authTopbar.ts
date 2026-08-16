import { getAuthenticatedIdentity } from './browserIdentity'

const PROFILE_CLASS = 'auth-controller-profile'

function makeTextElement(tag: string, className: string, text: string) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  return element
}

function buildProfile() {
  const identity = getAuthenticatedIdentity()
  const input = document.querySelector<HTMLInputElement>('input.controller-name')
  if (!identity || !input) return

  input.readOnly = true
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  input.classList.add('auth-controller-source')

  const actions = input.parentElement
  if (!actions) return

  let details = actions.querySelector<HTMLDetailsElement>(`.${PROFILE_CLASS}`)
  if (details) {
    const label = details.querySelector<HTMLElement>('.auth-controller-label')
    if (label) label.textContent = identity.displayName
    details.title = identity.tooltip
    return
  }

  details = document.createElement('details')
  details.className = PROFILE_CLASS
  details.title = identity.tooltip

  const summary = document.createElement('summary')
  summary.className = 'auth-controller-summary'
  summary.setAttribute('aria-label', 'Open IVAO account menu')
  summary.appendChild(makeTextElement('span', 'auth-controller-label', identity.displayName))
  summary.appendChild(makeTextElement('span', 'auth-controller-chevron', '⌄'))
  details.appendChild(summary)

  const menu = document.createElement('div')
  menu.className = 'auth-controller-menu'

  const heading = document.createElement('div')
  heading.className = 'auth-controller-heading'
  heading.appendChild(makeTextElement('strong', 'auth-controller-name', identity.name || `VID ${identity.vid}`))
  heading.appendChild(makeTextElement('span', 'auth-controller-vid', `VID ${identity.vid}`))
  menu.appendChild(heading)

  if (identity.isThailandStaff) {
    menu.appendChild(makeTextElement('div', 'auth-controller-role', 'THAILAND DIVISION STAFF'))

    const positions = identity.staffPositions ?? []
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

  const divider = document.createElement('div')
  divider.className = 'auth-controller-divider'
  menu.appendChild(divider)

  const signOut = document.createElement('a')
  signOut.className = 'auth-controller-signout'
  signOut.href = '/api/auth/logout'
  signOut.textContent = 'Sign out'
  menu.appendChild(signOut)

  details.appendChild(menu)

  const addFlightButton = actions.querySelector('.primary-button')
  actions.insertBefore(details, addFlightButton ?? null)

  document.addEventListener('click', (event) => {
    if (!details?.open) return
    const target = event.target
    if (target instanceof Node && !details.contains(target)) details.open = false
  })
}

export function installAuthTopbar() {
  let frame = 0
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(buildProfile)
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
