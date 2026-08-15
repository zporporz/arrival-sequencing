const TIME_SELECTOR = 'input[type="time"].cell-input'

function formatAtcTime(raw: string, fallback = '') {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''

  const formatted = digits.length <= 2
    ? digits
    : `${digits.slice(0, 2)}:${digits.slice(2)}`

  if (digits.length === 4) {
    const hours = Number(digits.slice(0, 2))
    const minutes = Number(digits.slice(2))
    if (hours > 23 || minutes > 59) return fallback
  }

  return formatted
}

function patchTimeInput(input: HTMLInputElement) {
  if (input.dataset.atcTimePatched === 'true') return

  const initialValue = input.value
  input.type = 'text'
  input.inputMode = 'numeric'
  input.maxLength = 5
  input.placeholder = 'HH:MM'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.dataset.atcTimePatched = 'true'
  input.dataset.lastValidTime = initialValue
  input.setAttribute('aria-label', input.getAttribute('aria-label') ?? 'UTC time in 24-hour HH:MM format')
}

function patchAllTimeInputs(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>(TIME_SELECTOR).forEach(patchTimeInput)
}

export function installAtcTimeInputs() {
  const start = () => {
    patchAllTimeInputs()

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(TIME_SELECTOR)) patchTimeInput(node as HTMLInputElement)
          patchAllTimeInputs(node)
        }
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    document.addEventListener('focusin', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return
      if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.value)) input.dataset.lastValidTime = input.value
    }, true)

    document.addEventListener('input', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return

      const fallback = input.dataset.lastValidTime ?? ''
      const formatted = formatAtcTime(input.value, fallback)
      if (input.value !== formatted) input.value = formatted

      if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(formatted)) {
        input.dataset.lastValidTime = formatted
      }
    }, true)

    document.addEventListener('focusout', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return
      if (input.value === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.value)) return

      const fallback = input.dataset.lastValidTime ?? ''
      input.value = fallback
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, true)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
