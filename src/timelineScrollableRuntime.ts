import { TIMELINE_DISPLAY_PX_PER_MINUTE, TIMELINE_FUTURE_HORIZON_MINUTES } from './timelineScale'

const PX_PER_MINUTE = TIMELINE_DISPLAY_PX_PER_MINUTE
const FUTURE_HORIZON_MINUTES = TIMELINE_FUTURE_HORIZON_MINUTES
const TOP_PADDING_PX = 36
const BOTTOM_PADDING_PX = 30

function readBelowActualMinutes(select: HTMLSelectElement | null) {
  const value = Number(select?.value)
  return Number.isFinite(value) ? value : 10
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function createTimeLabel(date: Date) {
  const label = document.createElement('span')
  label.className = 'aman-axis-time-box'

  const hour = document.createElement('small')
  hour.className = 'aman-axis-time-hour'
  hour.textContent = String(date.getUTCHours()).padStart(2, '0')

  const minute = document.createElement('strong')
  minute.className = 'aman-axis-time-minute'
  minute.textContent = String(date.getUTCMinutes()).padStart(2, '0')

  label.append(hour, minute)
  return label
}

export function installTimelineScrollableRuntime() {
  const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
  const select = document.querySelector<HTMLSelectElement>('.aman-history-control select')
  const panelMeta = document.querySelector<HTMLElement>('.aman-panel-meta')
  if (!stage) return () => {}

  stage.dataset.scrollTimeline = 'true'
  stage.dataset.timelineScale = String(PX_PER_MINUTE)

  let spacer = stage.querySelector<HTMLElement>(':scope > .aman-timeline-scroll-spacer')
  if (!spacer) {
    spacer = document.createElement('div')
    spacer.className = 'aman-timeline-scroll-spacer'
    spacer.setAttribute('aria-hidden', 'true')
    stage.prepend(spacer)
  }

  let overlay = stage.querySelector<HTMLElement>(':scope > .aman-runtime-time-axis')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'aman-runtime-time-axis'
    overlay.setAttribute('aria-hidden', 'true')
    stage.appendChild(overlay)
  }

  let nowButton = panelMeta?.querySelector<HTMLButtonElement>('.aman-timeline-now-button') ?? null
  if (!nowButton && panelMeta) {
    nowButton = document.createElement('button')
    nowButton.type = 'button'
    nowButton.className = 'aman-timeline-now-button'
    nowButton.textContent = 'NOW'
    nowButton.title = 'Return timeline to ACTUAL time'
    const testButton = panelMeta.querySelector('.aman-demo-toggle')
    panelMeta.insertBefore(nowButton, testButton)
  }

  const flightLayer = stage.querySelector<HTMLElement>('.aman-flight-layer')
  const emptySequence = stage.querySelector<HTMLElement>('.aman-empty-sequence')

  let actualWorldY = 0
  let contentHeight = 0
  let lastMinuteAnchor = Number.NaN
  let lastBelowMinutes = Number.NaN
  let followingActual = true
  let suppressScroll = false
  let disposed = false

  const actualScrollTop = () => {
    const belowPx = readBelowActualMinutes(select) * PX_PER_MINUTE
    const maxScroll = Math.max(0, contentHeight - stage.clientHeight)
    return clamp(actualWorldY - (stage.clientHeight - belowPx), 0, maxScroll)
  }

  const updateAwayState = () => {
    if (!nowButton) return
    const away = Math.abs(stage.scrollTop - actualScrollTop()) > 6
    nowButton.classList.toggle('is-away', away)
    nowButton.title = away ? 'Return timeline to ACTUAL time' : 'Timeline is following ACTUAL'
  }

  const scrollToActual = (behavior: ScrollBehavior = 'auto') => {
    followingActual = true
    suppressScroll = true
    stage.scrollTo({ top: actualScrollTop(), behavior })
    window.requestAnimationFrame(() => {
      suppressScroll = false
      updateAwayState()
    })
  }

  const rebuildTicks = (now: Date, force = false) => {
    if (!overlay) return
    const belowMinutes = readBelowActualMinutes(select)
    const minuteAnchor = new Date(now)
    minuteAnchor.setUTCSeconds(0, 0)
    const minuteAnchorMs = minuteAnchor.getTime()

    if (!force && minuteAnchorMs === lastMinuteAnchor && belowMinutes === lastBelowMinutes) return
    lastMinuteAnchor = minuteAnchorMs
    lastBelowMinutes = belowMinutes

    const fragment = document.createDocumentFragment()
    const pastMinutes = belowMinutes + 2

    for (let offset = -pastMinutes; offset <= FUTURE_HORIZON_MINUTES + 2; offset += 1) {
      const tickTime = new Date(minuteAnchorMs + offset * 60_000)
      const y = actualWorldY - offset * PX_PER_MINUTE
      if (y < -20 || y > contentHeight + 20) continue

      const tick = document.createElement('div')
      const isMajor = tickTime.getUTCMinutes() % 5 === 0
      tick.className = `aman-runtime-minute-tick ${isMajor ? 'is-major' : 'is-minor'}`
      tick.style.top = `${Math.round(y)}px`

      if (isMajor) tick.appendChild(createTimeLabel(tickTime))

      const marker = document.createElement('i')
      tick.appendChild(marker)
      fragment.appendChild(tick)
    }

    overlay.replaceChildren(fragment)
  }

  const updateAxisPhase = (now: Date) => {
    if (!overlay) return
    const secondIntoMinute = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000
    const phasePx = secondIntoMinute * PX_PER_MINUTE / 60
    overlay.style.transform = `translateY(${phasePx.toFixed(2)}px)`
  }

  const layoutWorld = (recenter = false) => {
    const belowMinutes = readBelowActualMinutes(select)
    const belowPx = belowMinutes * PX_PER_MINUTE
    actualWorldY = TOP_PADDING_PX + FUTURE_HORIZON_MINUTES * PX_PER_MINUTE
    contentHeight = actualWorldY + belowPx + BOTTOM_PADDING_PX

    stage.style.setProperty('--now-line', `${actualWorldY}px`)
    stage.style.setProperty('--timeline-content-height', `${contentHeight}px`)
    stage.style.setProperty('--timeline-future-minutes', String(FUTURE_HORIZON_MINUTES))
    stage.style.setProperty('--timeline-px-per-minute', `${PX_PER_MINUTE}px`)
    spacer!.style.height = `${contentHeight}px`
    overlay!.style.height = `${contentHeight}px`

    if (flightLayer) {
      flightLayer.style.height = `${contentHeight}px`
      flightLayer.style.bottom = 'auto'
    }
    if (emptySequence) emptySequence.style.top = `${Math.max(TOP_PADDING_PX + 50, actualWorldY - 180)}px`

    const now = new Date()
    rebuildTicks(now, true)
    updateAxisPhase(now)

    if (recenter || followingActual) window.requestAnimationFrame(() => scrollToActual('auto'))
    else updateAwayState()
  }

  const onScroll = () => {
    if (suppressScroll) return
    const nearActual = Math.abs(stage.scrollTop - actualScrollTop()) <= 6
    followingActual = nearActual
    updateAwayState()
  }

  const onSelect = () => {
    followingActual = true
    layoutWorld(true)
  }

  const onNow = () => scrollToActual('smooth')

  stage.addEventListener('scroll', onScroll, { passive: true })
  select?.addEventListener('change', onSelect)
  nowButton?.addEventListener('click', onNow)

  const resizeObserver = new ResizeObserver(() => {
    if (!disposed) layoutWorld(false)
  })
  resizeObserver.observe(stage)

  layoutWorld(true)

  const timer = window.setInterval(() => {
    if (disposed) return
    const now = new Date()
    rebuildTicks(now, false)
    updateAxisPhase(now)
  }, 1000)

  return () => {
    disposed = true
    window.clearInterval(timer)
    resizeObserver.disconnect()
    stage.removeEventListener('scroll', onScroll)
    select?.removeEventListener('change', onSelect)
    nowButton?.removeEventListener('click', onNow)
    nowButton?.remove()
    overlay?.remove()
    spacer?.remove()
    stage.removeAttribute('data-scroll-timeline')
    stage.removeAttribute('data-timeline-scale')
    stage.style.removeProperty('--timeline-content-height')
    stage.style.removeProperty('--timeline-future-minutes')
    stage.style.removeProperty('--timeline-px-per-minute')
    flightLayer?.style.removeProperty('height')
    flightLayer?.style.removeProperty('bottom')
  }
}
