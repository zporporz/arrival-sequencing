const PX_PER_MINUTE = 10

function formatHm(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function readBelowActualMinutes(select: HTMLSelectElement | null) {
  const value = Number(select?.value)
  return Number.isFinite(value) ? value : 10
}

export function installTimelineAxisRuntime() {
  const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
  const select = document.querySelector<HTMLSelectElement>('.aman-history-control select')

  if (!stage) return () => {}

  let overlay = stage.querySelector<HTMLElement>(':scope > .aman-runtime-time-axis')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'aman-runtime-time-axis'
    stage.appendChild(overlay)
  }

  let lastRenderKey = ''

  const rebuild = (force = false) => {
    const height = stage.clientHeight
    if (!height || !overlay) return

    const belowMinutes = readBelowActualMinutes(select)
    const belowPx = belowMinutes * PX_PER_MINUTE
    const actualY = Math.max(20, Math.min(height - 20, height - belowPx))
    stage.style.setProperty('--now-line', `${Math.round(actualY)}px`)

    const now = new Date()
    const minuteAnchor = new Date(now)
    minuteAnchor.setUTCSeconds(0, 0)

    // At 10 px/min the axis moves only 1 px about every 6 seconds.
    // Skip DOM replacement until the visible pixel position actually changes.
    const secondIntoMinute = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000
    const pixelPhase = Math.round(secondIntoMinute * PX_PER_MINUTE / 60)
    const renderKey = `${height}|${belowMinutes}|${minuteAnchor.getTime()}|${pixelPhase}`
    if (!force && renderKey === lastRenderKey) return
    lastRenderKey = renderKey

    const futureMinutesNeeded = Math.ceil(actualY / PX_PER_MINUTE) + 2
    const pastMinutesNeeded = Math.ceil((height - actualY) / PX_PER_MINUTE) + 2
    const fragment = document.createDocumentFragment()

    for (let offset = -pastMinutesNeeded; offset <= futureMinutesNeeded; offset += 1) {
      const tickTime = new Date(minuteAnchor.getTime() + offset * 60_000)
      const diffMinutes = (tickTime.getTime() - now.getTime()) / 60_000
      const y = Math.round(actualY - diffMinutes * PX_PER_MINUTE)
      if (y < -12 || y > height + 12) continue

      const tick = document.createElement('div')
      const isMajor = tickTime.getUTCMinutes() % 5 === 0
      tick.className = `aman-runtime-minute-tick ${isMajor ? 'is-major' : 'is-minor'}`
      tick.style.top = `${y}px`

      if (isMajor) {
        const label = document.createElement('span')
        label.textContent = formatHm(tickTime)
        tick.appendChild(label)
      }

      const marker = document.createElement('i')
      tick.appendChild(marker)
      fragment.appendChild(tick)
    }

    overlay.replaceChildren(fragment)
  }

  const resizeObserver = new ResizeObserver(() => rebuild(true))
  resizeObserver.observe(stage)

  const selectHandler = () => rebuild(true)
  select?.addEventListener('change', selectHandler)

  // Lightweight timer only checks whether the axis has moved a whole pixel.
  const timer = window.setInterval(() => rebuild(false), 1000)
  window.requestAnimationFrame(() => rebuild(true))

  return () => {
    window.clearInterval(timer)
    resizeObserver.disconnect()
    select?.removeEventListener('change', selectHandler)
    overlay?.remove()
  }
}
