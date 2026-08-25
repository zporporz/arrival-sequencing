import { afterEach, describe, expect, it } from 'vitest'
import { applyManualTargetsWithCascade } from '../src/AppMaestroV24'
import {
  autoSequenceUnstableArrivals,
  resolveAmanPairwiseSeparationSeconds,
  setAmanManualSequenceOrderSnapshot,
  type AmanArrivalPrediction,
  type AmanSequenceRow,
} from '../src/core/arrivalSequencing'
import {
  installManualSequenceReorderRuntime,
  isDownwardSequenceDrag,
  isWithinSequenceDropZone,
  shouldCommitSequenceReorder,
} from '../src/manualSequenceReorderRuntime'
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

afterEach(() => setAmanManualSequenceOrderSnapshot({}))

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

  it('dragging downward reorders only when released on the yellow target', () => {
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: true, hasDropTarget: false })).toBe(false)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: true, hasDropTarget: true })).toBe(true)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 80, moved: true, hasDropTarget: true })).toBe(false)
    expect(shouldCommitSequenceReorder({ startY: 100, pointerY: 140, moved: false, hasDropTarget: true })).toBe(false)
  })

  it('activates the yellow target before flight boxes physically overlap', () => {
    const rect = { left: 100, right: 500, top: 200, bottom: 228 }
    expect(isWithinSequenceDropZone(rect, 250, 185)).toBe(true)
    expect(isWithinSequenceDropZone(rect, 250, 179)).toBe(false)
    expect(isWithinSequenceDropZone(rect, 99, 210)).toBe(false)
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
})
