const MAX_SELECTED_AIRPORTS = 2

type DisplaySide = 'LEFT' | 'RIGHT'

const STORAGE_KEY = 'aman-airport-display-sides-v1'

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

function loadDisplaySides() {
  const fallback: Record<string, DisplaySide> = { VTBD: 'LEFT', VTBS: 'RIGHT' }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, DisplaySide>
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

export function installAirportScopeRuntime() {
  let host: HTMLElement | null = null
  let wrapper: HTMLDivElement | null = null
  let optionSignature = ''
  let syncing = false
  const displaySides = loadDisplaySides()

  const selectedValues = () => {
    if (!wrapper) return []
    return Array.from(wrapper.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
      .map((input) => input.value)
  }

  const saveDisplaySides = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(displaySides))
    } catch {
      // Preference persistence is optional; display still works without localStorage.
    }
  }

  const syncSideButtons = () => {
    if (!wrapper) return
    const selected = new Set(selectedValues())
    wrapper.querySelectorAll<HTMLButtonElement>('.aman-airport-side-button').forEach((button) => {
      const airport = button.dataset.airport || ''
      const side = button.dataset.side as DisplaySide | undefined
      button.disabled = !selected.has(airport)
      button.classList.toggle('is-active', Boolean(side && displaySides[airport] === side))
    })
  }

  const setDisplaySide = (airport: string, side: DisplaySide) => {
    displaySides[airport] = side

    // The MAESTRO timeline has two operational sides. If two selected airports collide,
    // the other selected airport is moved to the opposite side automatically.
    const opposite: DisplaySide = side === 'LEFT' ? 'RIGHT' : 'LEFT'
    for (const other of selectedValues()) {
      if (other !== airport && displaySides[other] === side) displaySides[other] = opposite
    }

    saveDisplaySides()
    syncSideButtons()
    applyTimelineSides()
  }

  const applyTimelineSides = () => {
    const selected = selectedValues()
    const selectedSet = new Set(selected)

    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      row.classList.remove('display-left', 'display-right')
      const title = row.getAttribute('title') || ''
      const airport = selected.find((value) => title.includes(`${value} RWY`))
      if (!airport || !selectedSet.has(airport)) return
      row.classList.add(displaySides[airport] === 'LEFT' ? 'display-left' : 'display-right')
    })

    const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
    if (!stage) return

    let guide = stage.querySelector<HTMLElement>(':scope > .aman-airport-side-guide')
    if (!guide) {
      guide = document.createElement('div')
      guide.className = 'aman-airport-side-guide'
      guide.innerHTML = '<span class="left"></span><span class="right"></span>'
      stage.appendChild(guide)
    }

    const left = selected.filter((airport) => displaySides[airport] === 'LEFT')
    const right = selected.filter((airport) => displaySides[airport] === 'RIGHT')
    const leftNode = guide.querySelector<HTMLElement>('.left')
    const rightNode = guide.querySelector<HTMLElement>('.right')
    if (leftNode) leftNode.textContent = left.length ? `LEFT · ${left.join(' / ')}` : 'LEFT · —'
    if (rightNode) rightNode.textContent = right.length ? `RIGHT · ${right.join(' / ')}` : 'RIGHT · —'
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

    if (selected.length === 2 && displaySides[selected[0]] === displaySides[selected[1]]) {
      displaySides[selected[1]] = displaySides[selected[0]] === 'LEFT' ? 'RIGHT' : 'LEFT'
      saveDisplaySides()
    }

    syncing = true
    try {
      const buttons = airportButtons(host)
      if (selected.length === 1) {
        buttons.find((button) => buttonValue(button) === selected[0])?.click()
      } else {
        // Current sequencing engine represents the supported two-airport set with the
        // hidden BOTH scope. The visible picker stays airport-by-airport.
        allButton(host)?.click()
      }
    } finally {
      syncing = false
    }

    syncSideButtons()
    applyTimelineSides()
  }

  const detach = () => {
    wrapper?.remove()
    host?.classList.remove('has-runtime-selector')
    document.querySelector('.aman-airport-side-guide')?.remove()
    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach((row) => {
      row.classList.remove('display-left', 'display-right')
    })
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
      label.className = 'aman-airport-choice'

      const input = document.createElement('input')
      input.type = 'checkbox'
      input.value = value
      input.setAttribute('aria-label', `Show ${value}`)
      input.addEventListener('change', () => syncUnderlyingScope(input))

      const text = document.createElement('span')
      text.className = 'aman-airport-choice-code'
      text.textContent = value

      const sideControls = document.createElement('div')
      sideControls.className = 'aman-airport-side-controls'
      sideControls.setAttribute('aria-label', `${value} timeline side`)

      for (const side of ['LEFT', 'RIGHT'] as const) {
        const sideButton = document.createElement('button')
        sideButton.type = 'button'
        sideButton.className = 'aman-airport-side-button'
        sideButton.dataset.airport = value
        sideButton.dataset.side = side
        sideButton.textContent = side === 'LEFT' ? 'L' : 'R'
        sideButton.title = `Show ${value} on ${side.toLowerCase()} side`
        sideButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          setDisplaySide(value, side)
        })
        sideControls.appendChild(sideButton)
      }

      label.append(input, text, sideControls)
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

    const selected = selectedValues()
    if (selected.length === 2 && displaySides[selected[0]] === displaySides[selected[1]]) {
      displaySides[selected[1]] = displaySides[selected[0]] === 'LEFT' ? 'RIGHT' : 'LEFT'
      saveDisplaySides()
    }

    syncSideButtons()
    applyTimelineSides()
  }

  attach()
  const timer = window.setInterval(attach, 500)

  return () => {
    window.clearInterval(timer)
    detach()
  }
}
