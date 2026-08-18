function buttonValue(button: HTMLButtonElement) {
  return (button.textContent || '').trim().toUpperCase()
}

function optionLabel(value: string) {
  return value === 'BOTH' ? 'ALL AIRPORTS' : value
}

export function installAirportScopeRuntime() {
  let host: HTMLElement | null = null
  let wrapper: HTMLLabelElement | null = null
  let select: HTMLSelectElement | null = null
  let optionSignature = ''

  const onChange = () => {
    if (!host || !select) return
    const target = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => buttonValue(button) === select?.value)
    target?.click()
  }

  const detach = () => {
    if (select) select.removeEventListener('change', onChange)
    wrapper?.remove()
    host?.classList.remove('has-runtime-selector')
    wrapper = null
    select = null
    host = null
    optionSignature = ''
  }

  const attach = () => {
    const nextHost = document.querySelector<HTMLElement>('.aman-airport-tabs')
    if (!nextHost) return

    if (host !== nextHost || !wrapper || !select || !nextHost.contains(wrapper)) {
      if (host && host !== nextHost) detach()
      host = nextHost
      host.classList.add('has-runtime-selector')

      wrapper = document.createElement('label')
      wrapper.className = 'aman-airport-scope-select'

      const caption = document.createElement('span')
      caption.textContent = 'AIRPORT VIEW'

      select = document.createElement('select')
      select.setAttribute('aria-label', 'Airport view')
      select.addEventListener('change', onChange)

      wrapper.append(caption, select)
      host.appendChild(wrapper)
      optionSignature = ''
    }

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    const values = buttons.map(buttonValue).filter(Boolean)
    const signature = values.join('|')

    if (select && signature !== optionSignature) {
      select.replaceChildren(...values.map((value) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = optionLabel(value)
        return option
      }))
      optionSignature = signature
    }

    const active = buttons.find((button) => button.classList.contains('is-active'))
    if (select && active) {
      const value = buttonValue(active)
      if (select.value !== value) select.value = value
    }
  }

  attach()
  const timer = window.setInterval(attach, 500)

  return () => {
    window.clearInterval(timer)
    detach()
  }
}
