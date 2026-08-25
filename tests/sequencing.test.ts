import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyManualTargetsWithCascade } from '../src/AppMaestroV24'
import {
  autoSequenceUnstableArrivals,
  resolveAmanPairwiseSeparationSeconds,
  setAmanManualSequenceOrderSnapshot,
  type AmanArrivalPrediction,
  type AmanSequenceRow,
} from '../src/core/arrivalSequencing'
import {
  amanSequenceScopeRunway,
  installManualSequenceReorderRuntime,
  isDownwardSequenceDrag,
  isWithinSequenceDropZone,
  mergeVisibleSequenceOrder,
  sequenceInsertionIndexForTarget,
  sequenceOrderAfterCrossedTargets,
  sequenceOrderForTarget,
  sequenceOrderRetryDelayMs,
  sequenceTargetChangesOrder,
  shouldCommitSequenceReorder,
} from '../src/manualSequenceReorderRuntime'
import { installTimelineDisplayScaleRuntime } from '../src/timelineDisplayScaleRuntime'
import type { AircraftPerformanceCategory } from '../src/core/api'

const BASE_SECONDS = 150
const sevenNmSeconds = 7 / 140 * 3600
const twelveNmSeconds = 12 / 140 * 3600
const categories: AircraftPerformanceCategory[] = ['A', 'B', 'C', 'D', 'E', 'H']

function prediction(
  callsign: string,
  category: AircraftPerformanceCategory,
  predictedIawpAt: string,
  runway = '19',
): AmanArrivalPrediction {
  return {
    id: `live:VTBS:${callsign}`,
    callsign,
    aircraftType: category === 'D' ? 'B763' : 'TEST',
    wakeTurbulence: null,
    performanceCategory: category,
    runway,
    refFix: 'NORTA',
    predictedIawpAt,
    nominalStarSeconds: 20 * 60,
  }
}

function rowsAt(times: string[], runways = times.map(() => '19')) {
  const arrivals = times.map((time, index) => prediction(`TST${index + 1}`, 'C', time, runways[index]))
  return autoSequenceUnstableArrivals(arrivals, {
    runwaySpacingSeconds: { '19': 120, '20L': 120 },
  })
}

afterEach(() => {
  setAmanManualSequenceOrderSnapshot({})
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pairwise separation', () => {
  it.each(categories.flatMap((leader) => categories.map((follower) => [leader, follower] as const)))(
    'covers leader %s followed by %s',
    (leader, follower) => {
      const expected = leader === 'B'
        ? follower === 'B' ? 120 : 240
        : leader === 'A' && follower === 'B'
          ? sevenNmSeconds
          : leader === 'A' && (follower === 'C' || follower === 'D')
            ? twelveNmSeconds
            : BASE_SECONDS

      expect(resolveAmanPairwiseSeparationSeconds(
        { aircraftType: 'TEST', performanceCategory: leader },
        { aircraftType: 'TEST', performanceCategory: follower },
        BASE_SECONDS,
      )).toBeCloseTo(expected, 6)
    },
  )

  it.each(categories)('applies 7 NM behind an A380 to follower %s', (follower) => {
    expect(resolveAmanPairwiseSeparationSeconds(
      { aircraftType: 'A388', performanceCategory: 'D' },
      { aircraftType: 'TEST', performanceCategory: follower },
      BASE_SECONDS,
    )).toBeCloseTo(sevenNmSeconds, 6)
  })
})

describe('manual drag sequencing', () => {
  it('uses one airport-wide order for VTBD but runway orders for VTBS', () => {
    expect(amanSequenceScopeRunway('VTBD', '21R')).toBe('ALL')
    expect(amanSequenceScopeRunway('VTBD', '21L')).toBe('ALL')
    expect(amanSequenceScopeRunway('VTBS', '19')).toBe('19')
    expect(amanSequenceScopeRunway('VTBS', '20R')).toBe('20R')
  })

  it('dragging upward pushes followers later without changing sequence rank', () => {
    const rows = rowsAt(['2026-08-25T10:00:00Z', '2026-08-25T10:03:00Z'])
    const leader = rows.find((row) => row.callsign === 'TST1')!
    const follower = rows.find((row) => row.callsign === 'TST2')!
    const originalRanks = new Map(rows.map((row) => [row.id, row.sequenceIndex]))
    const manualLeader = new Date(new Date(leader.tldt).getTime() + 5 * 60_000).toISOString()

    const result = applyManualTargetsWithCascade(
      rows,
      { [leader.id]: manualLeader },
      { '19': 120 },
      {},
    )
    const movedLeader = result.find((row) => row.id === leader.id)!
    const movedFollower = result.find((row) => row.id === follower.id)!

    expect(isDownwardSequenceDrag(100, 80)).toBe(false)
    expect(new Date(movedFollower.tldt).getTime() - new Date(movedLeader.tldt).getTime()).toBeGreaterThanOrEqual(120_000)
    expect(result.map((row) => [row.id, row.sequenceIndex])).toEqual(
      result.map((row) => [row.id, originalRanks.get(row.id)]),
    )
  })

  it('recognises a downward sequence drag', () => {
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: true, hasDropTarget: false })).toBe(false)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: true, hasDropTarget: true })).toBe(true)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 80, moved: true, hasDropTarget: true })).toBe(false)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: false, hasDropTarget: true })).toBe(false)
  })

  it('reorders immediately as a downward drag crosses callsigns', () => {
    expect(sequenceOrderAfterCrossedTargets(
      ['THA1', 'THA2', 'THA3', 'THA4'],
      'THA4',
      ['THA3', 'THA2'],
    )).toEqual(['THA1', 'THA4', 'THA2', 'THA3'])

    expect(sequenceOrderAfterCrossedTargets(
      ['THA1', 'THA2', 'THA3'],
      'THA3',
      ['THA2'],
    )).toEqual(['THA1', 'THA3', 'THA2'])
  })

  it('publishes the crossed callsign rank before pointerup', () => {
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: 0" title="VTBD RWY 21R"><strong>THA1</strong><span class="runway-assignment"><select><option selected>21R</option></select></span></div>
      <div class="aman-flight-row" style="--offset-px: -20px" title="VTBD RWY 21R"><strong>THA2</strong><span class="runway-assignment"><select><option selected>21R</option></select></span></div>
    `
    const [tha1Row, tha2Row] = Array.from(document.querySelectorAll<HTMLElement>('.aman-flight-row'))
    Object.defineProperty(tha1Row, 'getBoundingClientRect', {
      value: () => ({ left: 100, right: 500, top: 110, bottom: 130, width: 400, height: 20, x: 100, y: 110, toJSON: () => ({}) }),
      configurable: true,
    })
    Object.defineProperty(tha2Row, 'getBoundingClientRect', {
      value: () => ({ left: 100, right: 500, top: 80, bottom: 100, width: 400, height: 20, x: 100, y: 80, toJSON: () => ({}) }),
      configurable: true,
    })

    const removeRuntime = installManualSequenceReorderRuntime()
    tha2Row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 90 }))
    tha2Row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 200, clientY: 125 }))

    const result = autoSequenceUnstableArrivals([
      prediction('THA1', 'C', '2026-08-25T10:00:00Z', '21R'),
      prediction('THA2', 'C', '2026-08-25T10:03:00Z', '21R'),
    ].map((arrival) => ({ ...arrival, id: arrival.id.replace('VTBS', 'VTBD') })), {
      runwaySpacingSeconds: { '21R': 120 },
    })

    expect(Object.fromEntries(result.map((row) => [row.callsign, row.sequenceIndex]))).toEqual({ THA1: 2, THA2: 1 })
    removeRuntime()
  })

  it('activates the yellow target before flight boxes physically overlap', () => {
    const rect = { left: 100, right: 500, top: 200, bottom: 228 }
    expect(isWithinSequenceDropZone(rect, 250, 185)).toBe(true)
    expect(isWithinSequenceDropZone(rect, 250, 179)).toBe(false)
    expect(isWithinSequenceDropZone(rect, 99, 210)).toBe(false)
  })

  it('inserts before a yellow target without requiring the pointer to cross its centre', () => {
    expect(sequenceInsertionIndexForTarget(['THA2', 'THA1'], 'THA1', 'THA2')).toBe(0)
    expect(sequenceInsertionIndexForTarget(['THA1', 'THA2', 'THA3'], 'THA3', 'THA2')).toBe(1)
    expect(sequenceOrderForTarget(['THA1', 'THA2'], 'THA1', 'THA2')).toEqual(['THA1', 'THA2'])
    expect(sequenceOrderForTarget(['THA2', 'THA1'], 'THA1', 'THA2')).toEqual(['THA1', 'THA2'])
    expect(sequenceTargetChangesOrder(['THA1', 'THA2'], 'THA1', 'THA2')).toBe(false)
    expect(sequenceTargetChangesOrder(['THA2', 'THA1'], 'THA1', 'THA2')).toBe(true)
  })

  it('preserves existing ranks and inserts newly visible flights by target chronology', () => {
    expect(mergeVisibleSequenceOrder(
      ['THA1', 'THA3'],
      ['NEW0', 'THA3', 'NEW2', 'THA1', 'NEW4'],
    )).toEqual(['NEW0', 'NEW2', 'THA1', 'THA3', 'NEW4'])
  })

  it('keeps the dragged shortcut TLDT instead of replacing it with the old slot', () => {
    const base = rowsAt(['2026-08-25T15:05:00Z', '2026-08-25T15:15:00Z'])
    const tha2 = { ...base[0], id: 'live:VTBS:THA2', callsign: 'THA2', tldt: '2026-08-25T15:25:00.000Z', sequenceIndex: 2 }
    const tha1 = { ...base[1], id: 'live:VTBS:THA1', callsign: 'THA1', tldt: '2026-08-25T15:35:00.000Z', sequenceIndex: 1 }

    const result = applyManualTargetsWithCascade(
      [tha2, tha1],
      { [tha1.id]: '2026-08-25T15:20:00.000Z' },
      { '19': 120 },
      {},
    )

    expect(result.find((row) => row.id === tha1.id)?.tldt).toBe('2026-08-25T15:20:00.000Z')
    expect(result.find((row) => row.id === tha2.id)?.tldt).toBe('2026-08-25T15:25:00.000Z')
  })

  it('always snaps a dragged strip back to its true TLDT after pointerup', async () => {
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: -100px" title="VTBD RWY 21R"><strong>THA1</strong></div>
    `
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    Object.defineProperty(row, '__reactProps$test', {
      value: { onPointerMove: () => {} },
      configurable: true,
      enumerable: true,
    })
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ left: 500, right: 900, top: 100, bottom: 120, width: 400, height: 20, x: 500, y: 100, toJSON: () => ({}) }),
      configurable: true,
    })

    const removeRuntime = installTimelineDisplayScaleRuntime()
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }))
    row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientY: 140 }))
    expect(row.style.getPropertyValue('--display-offset-px')).toBe('-50px')

    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientY: 140 }))
    await new Promise((resolve) => window.setTimeout(resolve, 40))

    expect(row.style.getPropertyValue('--display-offset-px')).toBe('-90px')
    removeRuntime()
  })

  it('uses the same display drag path while Shift is held', () => {
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: -100px" title="VTBD RWY 21R"><strong>THA1</strong></div>
    `
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    Object.defineProperty(row, '__reactProps$test', {
      value: { onPointerMove: () => {} }, configurable: true, enumerable: true,
    })
    const removeRuntime = installTimelineDisplayScaleRuntime()
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100, shiftKey: true }))
    row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientY: 140, shiftKey: true }))
    expect(row.style.getPropertyValue('--display-offset-px')).toBe('-50px')
    removeRuntime()
  })

  it('uses explicit VTBD rank for cross-runway cascade', () => {
    const base = autoSequenceUnstableArrivals([
      prediction('THA1', 'C', '2026-08-25T15:05:00Z', '21R'),
      prediction('RTAF2', 'C', '2026-08-25T15:15:00Z', '21L'),
    ], { runwaySpacingSeconds: { '21R': 120, '21L': 120 } })
    const leader = { ...base[0], id: 'live:VTBD:THA1', callsign: 'THA1', runway: '21R', tldt: '2026-08-25T15:25:00.000Z', sequenceIndex: 1 }
    const follower = { ...base[1], id: 'live:VTBD:RTAF2', callsign: 'RTAF2', runway: '21L', tldt: '2026-08-25T15:35:00.000Z', sequenceIndex: 2 }
    const result = applyManualTargetsWithCascade(
      [leader, follower],
      { [follower.id]: '2026-08-25T15:20:00.000Z' },
      { '21R': 120, '21L': 120 },
      {},
    )
    expect(result.find((row) => row.id === leader.id)?.tldt).toBe('2026-08-25T15:25:00.000Z')
    expect(result.find((row) => row.id === follower.id)?.tldt).toBe('2026-08-25T15:27:00.000Z')
  })

  it('retries a failed shared sequence write without inventing a local revision', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ sequenceOrder: { revision: 9 } }) })
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: -100px" title="VTBS RWY 19"><strong>THA1</strong><span class="runway-assignment"><select><option selected>19</option></select></span></div>
    `
    const row = document.querySelector<HTMLElement>('.aman-flight-row')!
    const removeRuntime = installManualSequenceReorderRuntime()
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }))
    row.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientY: 80 }))
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientY: 80 }))
    await vi.runAllTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sequenceOrderRetryDelayMs(0)).toBe(300)
    expect(sequenceOrderRetryDelayMs(1)).toBe(600)
    removeRuntime()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps explicit sequence ranks when TLDT chronology crosses', () => {
    const rows = rowsAt(
      ['2026-08-25T10:00:00Z', '2026-08-25T10:06:00Z'],
      ['19', '20L'],
    )
    const first = rows.find((row) => row.callsign === 'TST1')!
    const second = rows.find((row) => row.callsign === 'TST2')!
    const crossed = applyManualTargetsWithCascade(
      rows,
      { [second.id]: '2026-08-25T09:55:00.000Z' },
      { '19': 0, '20L': 0 },
      {},
    ) as AmanSequenceRow[]

    expect(crossed[0].id).toBe(second.id)
    expect(crossed.find((row) => row.id === first.id)?.sequenceIndex).toBe(first.sequenceIndex)
    expect(crossed.find((row) => row.id === second.id)?.sequenceIndex).toBe(second.sequenceIndex)
  })
})

describe('shared sequence reload', () => {
  it('rehydrates the same ranks received from another controller', () => {
    const arrivals = [
      prediction('THA101', 'C', '2026-08-25T10:00:00Z'),
      prediction('THA202', 'C', '2026-08-25T10:03:00Z'),
    ]
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: 0" title="VTBS RWY 19"><strong>THA101</strong><span class="runway-assignment"><select><option selected>19</option></select></span></div>
      <div class="aman-flight-row" style="--offset-px: -20" title="VTBS RWY 19"><strong>THA202</strong><span class="runway-assignment"><select><option selected>19</option></select></span></div>
    `
    const sharedEvent = () => new CustomEvent('aman:shared-state', { detail: {
      sequenceOrders: [{
        airport: 'VTBS',
        runway: '19',
        ordered_callsigns: ['THA202', 'THA101'],
        revision: 7,
      }],
    } })
    const ranks = (rows: AmanSequenceRow[]) => Object.fromEntries(rows.map((row) => [row.callsign, row.sequenceIndex]))

    const removeControllerA = installManualSequenceReorderRuntime()
    window.dispatchEvent(sharedEvent())
    const controllerA = autoSequenceUnstableArrivals(arrivals, { runwaySpacingSeconds: { '19': 120 } })
    const controllerARanks = ranks(controllerA)
    removeControllerA()

    const removeReloadedController = installManualSequenceReorderRuntime()
    window.dispatchEvent(sharedEvent())
    const reloadedController = autoSequenceUnstableArrivals(arrivals, { runwaySpacingSeconds: { '19': 120 } })
    const reloadedRanks = ranks(reloadedController)
    removeReloadedController()

    expect(controllerARanks).toEqual({ THA101: 2, THA202: 1 })
    expect(reloadedRanks).toEqual(controllerARanks)
  })

  it('rehydrates one VTBD order across 21R and 21L', () => {
    const arrivals = [
      prediction('THA101', 'C', '2026-08-25T10:00:00Z', '21R'),
      prediction('RTAF202', 'C', '2026-08-25T10:03:00Z', '21L'),
    ].map((arrival) => ({ ...arrival, id: arrival.id.replace('VTBS', 'VTBD') }))
    document.body.innerHTML = `
      <div class="aman-flight-row" style="--offset-px: 0" title="VTBD RWY 21R"><strong>THA101</strong><span class="runway-assignment"><select><option selected>21R</option></select></span></div>
      <div class="aman-flight-row" style="--offset-px: -20" title="VTBD RWY 21L"><strong>RTAF202</strong><span class="runway-assignment"><select><option selected>21L</option></select></span></div>
    `
    const removeRuntime = installManualSequenceReorderRuntime()
    window.dispatchEvent(new CustomEvent('aman:shared-state', { detail: {
      sequenceOrders: [{
        airport: 'VTBD',
        runway: 'ALL',
        ordered_callsigns: ['RTAF202', 'THA101'],
        revision: 1,
      }],
    } }))

    const result = autoSequenceUnstableArrivals(arrivals, {
      runwaySpacingSeconds: { '21R': 120, '21L': 120 },
    })
    const ranks = Object.fromEntries(result.map((row) => [row.callsign, row.sequenceIndex]))
    removeRuntime()

    expect(ranks).toEqual({
      THA101: 2,
      RTAF202: 1,
    })
  })
})
