type DisplaySide = 'LEFT' | 'RIGHT'

type PackedRow = {
  row: HTMLElement
  anchor: number
  packed: number
  height: number
}

const PACKING_MARGIN_PX = 4
const MIN_CENTER_GAP_PX = 34
const MUTATION_ATTRIBUTES = ['style', 'class', 'data-display-side']

function finiteCssPx(element: HTMLElement, name: string) {
  const value = Number.parseFloat(element.style.getPropertyValue(name))
  return Number.isFinite(value) ? value : null
}

function rowSide(row: HTMLElement): DisplaySide {
  const value = row.dataset.displaySide
  if (value === 'LEFT' || value === 'RIGHT') return value
  if (row.classList.contains('display-left')) return 'LEFT'
  return 'RIGHT'
}

function ensureLeader(row: HTMLElement) {
  let leader = row.querySelector<HTMLElement>(':scope > .aman-time-anchor-link')
  if (!leader) {
    leader = document.createElement('i')
    leader.className = 'aman-time-anchor-link'
    leader.setAttribute('aria-hidden', 'true')
    row.appendChild(leader)
  }
  return leader
}

function requiredGap(a: PackedRow, b: PackedRow) {
  return Math.max(MIN_CENTER_GAP_PX, (a.height + b.height) / 2 + PACKING_MARGIN_PX)
}

function relaxGroup(group: PackedRow[]) {
  if (group.length < 2) return

  group.sort((a, b) => a.anchor - b.anchor)
  for (const item of group) item.packed = item.anchor

  // Symmetric overlap relaxation preserves order while spreading a busy arrival bank
  // around its true time anchors instead of pushing the whole bank only one direction.
  for (let pass = 0; pass < 32; pass += 1) {
    let changed = false
    for (let index = 0; index < group.length - 1; index += 1) {
      const upper = group[index]
      const lower = group[index + 1]
      const minimum = requiredGap(upper, lower)
      const actual = lower.packed - upper.packed
      if (actual + 0.25 >= minimum) continue
      const correction = (minimum - actual) / 2
      upper.packed -= correction
      lower.packed += correction
      changed = true
    }
    if (!changed) break
  }
}

function keepInsideStage(group: PackedRow[], stage: HTMLElement) {
  if (!group.length) return
  const stageRect = stage.getBoundingClientRect()
  const currentLine = stage.querySelector<HTMLElement>('.aman-current-line')
  const nowY = currentLine
    ? currentLine.getBoundingClientRect().top - stageRect.top
    : stageRect.height * 0.68

  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const item of group) {
    top = Math.min(top, item.packed - item.height / 2)
    bottom = Math.max(bottom, item.packed + item.height / 2)
  }

  const minOffset = -nowY + 6
  const maxOffset = stageRect.height - nowY - 6
  const span = bottom - top
  const available = maxOffset - minOffset
  if (span > available) return

  let shift = 0
  if (top < minOffset) shift += minOffset - top
  if (bottom + shift > maxOffset) shift += maxOffset - (bottom + shift)
  if (Math.abs(shift) < 0.25) return
  for (const item of group) item.packed += shift
}

function setDensity(stage: HTMLElement, rows: HTMLElement[]) {
  const sideCounts: Record<DisplaySide, number> = { LEFT: 0, RIGHT: 0 }
  for (const row of rows) sideCounts[rowSide(row)] += 1
  const maximum = Math.max(sideCounts.LEFT, sideCounts.RIGHT)
  const next = maximum >= 18 ? 'ultra' : maximum >= 11 ? 'dense' : 'normal'
  if (stage.dataset.labelDensity !== next) stage.dataset.labelDensity = next
}

function applyPackedPosition(item: PackedRow) {
  const displacement = item.anchor - item.packed
  const row = item.row
  const packedValue = `${Math.round(item.packed * 10) / 10}px`
  if (row.style.getPropertyValue('--packed-offset-px') !== packedValue) {
    row.style.setProperty('--packed-offset-px', packedValue)
  }

  const packed = Math.abs(displacement) >= 1.5
  row.dataset.labelPacked = packed ? 'true' : 'false'

  const leader = ensureLeader(row)
  if (!packed) {
    leader.hidden = true
    return
  }

  leader.hidden = false
  const height = Math.abs(displacement)
  const halfRow = item.height / 2
  const leaderTop = halfRow + Math.min(0, displacement)
  leader.style.setProperty('--leader-top-px', `${Math.round(leaderTop * 10) / 10}px`)
  leader.style.setProperty('--leader-height-px', `${Math.max(1, Math.round(height * 10) / 10)}px`)
  leader.dataset.anchorDirection = displacement < 0 ? 'above' : 'below'
}

function clearPacking(row: HTMLElement) {
  row.style.removeProperty('--packed-offset-px')
  delete row.dataset.labelPacked
  row.querySelector(':scope > .aman-time-anchor-link')?.remove()
}

export function installTimelineLabelPackingRuntime() {
  let disposed = false
  let scheduled = false

  const pack = () => {
    scheduled = false
    if (disposed) return
    const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
    if (!stage) return
    const rows = Array.from(stage.querySelectorAll<HTMLElement>('.aman-flight-row'))
    if (!rows.length) return

    setDensity(stage, rows)

    // Density mode may change row height. Measure after the density attribute is set.
    const groups: Record<DisplaySide, PackedRow[]> = { LEFT: [], RIGHT: [] }
    for (const row of rows) {
      const anchor = finiteCssPx(row, '--offset-px')
      if (anchor == null) {
        clearPacking(row)
        continue
      }
      const height = Math.max(24, row.getBoundingClientRect().height)
      groups[rowSide(row)].push({ row, anchor, packed: anchor, height })
    }

    for (const side of ['LEFT', 'RIGHT'] as const) {
      const group = groups[side]
      relaxGroup(group)
      keepInsideStage(group, stage)
      group.forEach(applyPackedPosition)
    }
  }

  const schedule = () => {
    if (disposed || scheduled) return
    scheduled = true
    window.requestAnimationFrame(pack)
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      if (mutation.type === 'childList') return true
      if (mutation.type !== 'attributes') return false
      const target = mutation.target
      return target instanceof HTMLElement
        && (target.classList.contains('aman-flight-row') || target.classList.contains('aman-timeline-stage'))
    })) schedule()
  })

  const attach = () => {
    const stage = document.querySelector<HTMLElement>('.aman-timeline-stage')
    if (!stage) return false
    observer.observe(stage, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: MUTATION_ATTRIBUTES,
    })
    schedule()
    return true
  }

  if (!attach()) {
    const wait = window.setInterval(() => {
      if (attach()) window.clearInterval(wait)
    }, 250)
    return () => {
      disposed = true
      window.clearInterval(wait)
      observer.disconnect()
      document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(clearPacking)
    }
  }

  const resize = () => schedule()
  window.addEventListener('resize', resize)

  return () => {
    disposed = true
    observer.disconnect()
    window.removeEventListener('resize', resize)
    document.querySelectorAll<HTMLElement>('.aman-flight-row').forEach(clearPacking)
    document.querySelector<HTMLElement>('.aman-timeline-stage')?.removeAttribute('data-label-density')
  }
}
