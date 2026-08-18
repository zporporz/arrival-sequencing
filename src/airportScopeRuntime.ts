const MAX_SELECTED_AIRPORTS = 3

function buttonValue(button: HTMLButtonElement) {
  return (button.textContent || '').trim().toUpperCase()
}

function airportButtons(host: HTMLElement) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .filter((button) => buttonValue(button) !== 'BOTH')
}

function allButton(host: HTMLElement) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => buttonValue(button) === 'BOTH') ?? null
}

export function installAirportScopeRuntime() {
  let host: HTMLElement | null = null
  let wrapper: HTMLDivElement | null = null
  let optionSignature = ''
  let syncing = false

  const selectedValues = () => {
    if (!wrapper) return []
    return Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
      .map((input) => input.value)
  }

  const syncUnderlyingScope = (changedInput?: HTMLInputElement) => {
    if (!host || !wrapper || syncing) return

    let selected = selectedValues()

    if (!selected.length && changedInput) {
      changedInput.checked = true
      return
    }

    if (selected.length > MAX_SELECTED_AIRPORTS && changedInput) {
      changedInput.checked = false
      selected = selectedValues()
    }

    syncing = true
    try {
      const buttons = airportButtons(host)
      if (selected.length === 1) {
        buttons.find((button) => buttonValue(button) === selected[0])?.click()
      } else {
        // Current sequencing engine represents the supported multi-airport set with the
        // hidden BOTH scope. The picker UI intentionally exposes individual airports only.
        allButton(host)?.click()
      }
    } finally {
      syncing = false
    }
  }

  const detach = () => {
    wrapper?.remove()
    host?.classList.remove('has-runtime-selector')
    wrapper = null
    host = null
    optionSignature = ''
  }

  const buildPicker = (values: string[]) => {
    if (!host) return

    wrapper?.remove()
    wrapper = document.createElement('div')
    wrapper.className = 'aman-airport-scope-picker'

    const heading = document.createElement('div')
    heading.className = 'aman-airport-picker-heading'

    const caption = document.createElement('span')
    caption.textContent = 'AIRPORT VIEW'

    const limit = document.createElement('small')
    limit.textContent = `SELECT UP TO ${MAX_SELECTED_AIRPORTS}`

    heading.append(caption, limit)

    const choices = document.createElement('div')
    choices.className = 'aman-airport-checks'

    for (const value of values) {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.value = value
      input.setAttribute('aria-label', `Show ${value}`)
      input.addEventListener('change', () => syncUnderlyingScope(input))

      const text = document.createElement('span')
      text.textContent = value

      label.append(input, text)
      choices.appendChild(label)
    }

    wrapper.append(heading, choices)
    host.appendChild(wrapper)
  }

  const attach = () => {
    const nextHost = document.querySelector<HTMLElement>('.aman-airport-tabs')
    if (!nextHost) return

    if (host !== nextHost) {
      if (host) detach()
      host = nextHost
      host.classList.add('has-runtime-selector')
    }

    const buttons = airportButtons(nextHost)
    const values = buttons.map(buttonValue).filter(Boolean)
    const signature = values.join('|')

    if (!wrapper || !nextHost.contains(wrapper) || signature !== optionSignature) {
      buildPicker(values)
      optionSignature = signature
    }

    if (!wrapper || syncing) return

    const active = Array.from(nextHost.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.classList.contains('is-active'))
    const activeValue = active ? buttonValue(active) : ''
    const multiActive = activeValue === 'BOTH'

    wrapper.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
      input.checked = multiActive ? true : input.value === activeValue
    })
  }

  attach()
  const timer = window.setInterval(attach, 500)

  return () => {
    window.clearInterval(timer)
    detach()
  }
}
