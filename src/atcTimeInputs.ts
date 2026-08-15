const TIME_SELECTOR = 'input.cell-input.time'
const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

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
  // React still renders this control with type="time". If React writes the
  // attribute back on a later render, force it back to a plain text field so
  // Chrome/Firefox cannot apply locale-specific AM/PM presentation.
  if (input.type !== 'text') input.type = 'text'

  if (input.dataset.atcTimePatched === 'true') return

  const initialValue = input.value
  input.inputMode = 'numeric'
  input.maxLength = 5
  input.placeholder = 'HH:MM'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.dataset.atcTimePatched = 'true'
  input.dataset.lastValidTime = VALID_TIME.test(initialValue) ? initialValue : ''
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
        if (mutation.type === 'attributes') {
          const target = mutation.target
          if (
            target instanceof HTMLInputElement &&
            target.matches(TIME_SELECTOR) &&
            target.type !== 'text'
          ) {
            patchTimeInput(target)
          }
          continue
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(TIME_SELECTOR)) patchTimeInput(node as HTMLInputElement)
          patchAllTimeInputs(node)
        }
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type'],
    })

    document.addEventListener('focusin', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return
      if (VALID_TIME.test(input.value)) input.dataset.lastValidTime = input.value
    }, true)

    document.addEventListener('input', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return

      const fallback = input.dataset.lastValidTime ?? ''
      const formatted = formatAtcTime(input.value, fallback)
      if (input.value !== formatted) input.value = formatted

      if (VALID_TIME.test(formatted)) input.dataset.lastValidTime = formatted
    }, true)

    document.addEventListener('focusout', (event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement) || input.dataset.atcTimePatched !== 'true') return
      if (input.value === '' || VALID_TIME.test(input.value)) return

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
