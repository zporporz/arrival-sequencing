const PX_PER_MINUTE = 10

function formatHm(date: Date) {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

function selectedBelowActualMinutes() {
  const select = document.querySelector<HTMLSelectElement>('.aman-history-control select')
  const value = Number(select?.value)
  return Number.isFinite(value) ? value : 10
}

function rebuildTimelineAxis() {
  const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
  if (!stage) return

  let overlay = stage.querySelector<HTMLElement>(':scope > .aman-runtime-time-axis')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'aman-runtime-time-axis'
    stage.appendChild(overlay)
  }

  const height = stage.clientHeight
  if (!height) return

  const belowMinutes = selectedBelowActualMinutes()
  const belowPx = belowMinutes * PX_PER_MINUTE
  const actualY = Math.max(20, Math.min(height - 20, height - belowPx))
  stage.style.setProperty('--now-line', `${Math.round(actualY)}px`)

  const now = new Date()
  const minuteAnchor = new Date(now)
  minuteAnchor.setUTCSeconds(0, 0)

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

export function installTimelineAxisRuntime() {
  let resizeObserver: ResizeObserver | null = null
  let select: HTMLSelectElement | null = null
  let selectHandler: (() => void) | null = null
  let stage: HTMLElement | null = null

  const attach = () => {
    const nextStage = document.querySelector<HTMLElement>('.aman-timeline-stage')
    const nextSelect = document.querySelector<HTMLSelectElement>('.aman-history-control select')

    if (nextStage !== stage) {
      resizeObserver?.disconnect()
      stage = nextStage
      if (stage) {
        resizeObserver = new ResizeObserver(rebuildTimelineAxis)
        resizeObserver.observe(stage)
      }
    }

    if (nextSelect !== select) {
      if (select && selectHandler) select.removeEventListener('change', selectHandler)
      select = nextSelect
      selectHandler = rebuildTimelineAxis
      select?.addEventListener('change', selectHandler)
    }

    rebuildTimelineAxis()
  }

  attach()
  const domObserver = new MutationObserver(attach)
  domObserver.observe(document.body, { childList: true, subtree: true })
  const timer = window.setInterval(rebuildTimelineAxis, 1000)

  return () => {
    window.clearInterval(timer)
    domObserver.disconnect()
    resizeObserver?.disconnect()
    if (select && selectHandler) select.removeEventListener('change', selectHandler)
  }
}
