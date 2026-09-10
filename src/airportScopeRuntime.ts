import { displaySidesFromDom, selectedAmanAirports } from './core/airports'

// React owns the picker; this runtime only places legacy timeline strips.
export function installAirportScopeRuntime() {
  const apply = () => {
    const sides = displaySidesFromDom(), selected = selectedAmanAirports()
    document.querySelectorAll<HTMLElement>('.aman-flight-row, .aman-provisional-row').forEach(row => {
      const airport = selected.find(code => row.dataset.airport === code || row.title.includes(code + ' RWY'))
      if (airport) row.dataset.displaySide = sides[airport]
      else delete row.dataset.displaySide
    })
    const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
    if (!stage) return
    let guide = stage.querySelector<HTMLElement>(':scope > .aman-airport-side-guide')
    if (!guide) {
      guide = document.createElement('div')
      guide.className = 'aman-airport-side-guide'
      for (const side of ['left', 'right']) {
        const span = document.createElement('span'); span.className = side; guide.append(span)
      }
      stage.append(guide)
    }
    for (const side of ['LEFT', 'RIGHT'] as const) {
      const span = guide.querySelector('.' + side.toLowerCase())
      const text = side + ' · ' + (selected.filter(code => sides[code] === side).join(' / ') || '—')
      if (span && span.textContent !== text) span.textContent = text
    }
  }
  apply()
  const timer = window.setInterval(apply, 250)
  window.addEventListener('aman:airport-selection-change', apply)
  return () => {
    clearInterval(timer)
    window.removeEventListener('aman:airport-selection-change', apply)
    document.querySelector('.aman-airport-side-guide')?.remove()
  }
}
