const PROXY_ID = 'workspace-add-flight-button'

function getSourceButton() {
  return document.querySelector<HTMLButtonElement>('.topbar .primary-button')
}

function getSearchInput() {
  return document.querySelector<HTMLInputElement>('.workspace-toolbar input[aria-label="Search flights"]')
}

function ensureProxy() {
  let proxy = document.getElementById(PROXY_ID) as HTMLButtonElement | null
  if (proxy) return proxy

  proxy = document.createElement('button')
  proxy.id = PROXY_ID
  proxy.type = 'button'
  proxy.className = 'primary-button workspace-add-flight-button'
  proxy.textContent = '+ Add Flight'
  proxy.setAttribute('aria-label', 'Add flight')
  proxy.addEventListener('click', () => {
    const source = getSourceButton()
    if (source && !source.disabled) source.click()
  })
  document.body.appendChild(proxy)
  return proxy
}

function syncPlacement() {
  const source = getSourceButton()
  const search = getSearchInput()
  const proxy = ensureProxy()

  if (!source || !search) {
    proxy.hidden = true
    return
  }

  source.classList.add('add-flight-source-hidden')
  source.setAttribute('aria-hidden', 'true')
  source.tabIndex = -1

  proxy.hidden = false
  proxy.disabled = source.disabled

  const searchRect = search.getBoundingClientRect()
  const proxyRect = proxy.getBoundingClientRect()
  const gap = 10

  proxy.style.left = `${Math.round(Math.max(12, searchRect.left - proxyRect.width - gap))}px`
  proxy.style.top = `${Math.round(searchRect.top + (searchRect.height - proxyRect.height) / 2)}px`
}

export function installAddFlightPlacement() {
  const schedule = () => window.requestAnimationFrame(syncPlacement)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true })
  } else {
    schedule()
  }

  window.setInterval(schedule, 500)
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, { passive: true })
}
