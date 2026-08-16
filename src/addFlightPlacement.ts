const PROXY_ID = 'workspace-add-flight-button'

function getSourceButton() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.topbar-actions button')]
  return buttons.find((button) => button.textContent?.trim().includes('Add Flight')) ?? null
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

function hideSource(source: HTMLButtonElement) {
  source.classList.add('add-flight-source-hidden')
  source.setAttribute('aria-hidden', 'true')
  source.tabIndex = -1
  source.style.setProperty('display', 'none', 'important')
}

function syncPlacement() {
  const source = getSourceButton()
  const search = getSearchInput()
  const proxy = ensureProxy()

  if (source) hideSource(source)

  if (!source || !search) {
    proxy.hidden = true
    return
  }

  proxy.hidden = false
  proxy.disabled = source.disabled

  const searchRect = search.getBoundingClientRect()
  const proxyRect = proxy.getBoundingClientRect()
  const gap = 10
  const desiredLeft = searchRect.left - proxyRect.width - gap

  proxy.style.left = `${Math.round(Math.max(12, desiredLeft))}px`
  proxy.style.top = `${Math.round(searchRect.top + (searchRect.height - proxyRect.height) / 2)}px`
}

export function installAddFlightPlacement() {
  let frame = 0
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(syncPlacement)
  }

  const start = () => {
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
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
