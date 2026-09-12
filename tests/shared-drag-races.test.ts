import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let installSharedAmanRuntime: typeof import('../src/sharedAmanRuntime').installSharedAmanRuntime

const date = '2026-09-12'
const at = (minutes: number) => `2026-09-12T10:${String(minutes).padStart(2, '0')}:00.000Z`
const base = { service_date: date, airport: 'VTBS', callsign: 'RACE1', revision: 10,
  target_revision: 0, target_mode: 'AUTO', manual_tldt: null, manual_runway: null }
const manual = (revision: number, minutes: number, targetRevision = 1) => ({ ...base,
  revision, target_revision: targetRevision, target_mode: 'MANUAL', manual_tldt: at(minutes), manual_runway: '19' })
const snapshot = (flight = base) => Response.json({ serviceDate: date, workspaceStates: [], flightStates: [flight], sequenceOrders: [] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const cleanups: (() => void)[] = []
const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(`aman:${name}`, { detail }))

beforeEach(async () => {
  vi.resetModules()
  ;({ installSharedAmanRuntime } = await import('../src/sharedAmanRuntime'))
  vi.useFakeTimers()
  vi.setSystemTime(`${date}T10:00:00Z`)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 16))
})
afterEach(() => {
  cleanups.splice(0).reverse().forEach(fn => fn())
  vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ''
})

function row() {
  const element = document.createElement('div')
  element.className = 'aman-flight-row'
  element.title = 'VTBS RWY 19'
  element.innerHTML = '<span>10:10</span><strong>RACE1</strong><em class="runway-assignment"><select><option>19</option></select></em>'
  const setTime = (time: string) => { element.dataset.targetTldt = time }
  setTime(at(10))
  const clear = vi.fn(() => { setTime(at(10)); element.classList.remove('is-stable') })
  let start = 0
  const move = vi.fn((event: { clientY: number }) => {
    setTime(new Date(start - event.clientY / 10 * 60000).toISOString())
  })
  Object.defineProperty(element, '__reactProps$test', { enumerable: true, value: {
    onDoubleClick: clear,
    onPointerDown: () => { start = Date.parse(element.dataset.targetTldt!) },
    onPointerMove: move,
    onPointerUp: () => element.classList.add('is-stable'),
  } })
  document.body.append(element)
  const drag = (minutes: number) => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    setTime(at(minutes)); element.classList.add('is-stable')
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
  }
  return { element, clear, move, drag }
}
async function start() {
  cleanups.push(installSharedAmanRuntime())
  await vi.advanceTimersByTimeAsync(0)
}

describe('drag intent survives concurrent shared updates', () => {
  it('accepts a poll acknowledgement and then allows the next committed target', async () => {
    const view = row()
    let current = base
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => snapshot(current))
    await start()
    emit('realtime-manual-release', { airport: 'VTBS', callsign: 'RACE1', previewId: 'poll-ack',
      runway: '19', targetAt: at(20), originalTargetAt: at(10), originalRunway: '19' })
    await vi.advanceTimersByTimeAsync(20)
    current = manual(11, 20)
    emit('force-shared-refresh', {})
    await vi.advanceTimersByTimeAsync(20)
    emit('realtime-flight-state', manual(12, 25, 2))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(25))
    expect(view.element.dataset.sharedRevision).toBe('12')
  })
  it('recovers authoritative state if a remote release never receives an acknowledgement or cancel', async () => {
    const view = row()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => snapshot())
    await start()
    emit('realtime-manual-release', { airport: 'VTBS', callsign: 'RACE1', previewId: 'lost-release',
      runway: '19', targetAt: at(20), originalTargetAt: at(10), originalRunway: '19' })
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(20))
    await vi.advanceTimersByTimeAsync(30_100)
    expect(view.element.dataset.targetTldt).toBe(at(10))
    expect(view.element.dataset.realtimeReleasePreview).toBeUndefined()
    expect(view.element.dataset.targetMode).toBe('AUTO')
  })
  it('rolls back a rejected save instead of leaving an unsaved Manual target on screen', async () => {
    const view = row()
    const failed = vi.fn()
    window.addEventListener('aman:realtime-commit-failed', failed)
    cleanups.push(() => window.removeEventListener('aman:realtime-commit-failed', failed))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST'
      ? Response.json({ error: 'Target changed', code: 'STALE_TARGET' }, { status: 409 }) : snapshot())
    await start(); view.drag(20)
    await vi.advanceTimersByTimeAsync(150)
    expect(failed).toHaveBeenCalledTimes(1)
    expect(view.element.dataset.targetTldt).toBe(at(10))
    expect(view.element.dataset.targetMode).toBe('AUTO')
  })
  it('does not let the first remote save overwrite the second release through polling', async () => {
    const view = row()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => snapshot())
    await start()
    emit('realtime-manual-release', { airport: 'VTBS', callsign: 'RACE1', previewId: 'latest',
      runway: '19', targetAt: at(25), originalTargetAt: at(10), originalRunway: '19' })
    await vi.advanceTimersByTimeAsync(20)
    emit('realtime-flight-state', manual(11, 20))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(25))
    emit('realtime-flight-state', manual(12, 25, 2))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(25))
    expect(view.element.dataset.sharedRevision).toBe('12')
  })
  it.each(['UNSTABLE', 'STABLE', 'FROZEN'])('protects a %s release before and during its save', async stage => {
    const view = row(); view.element.dataset.flightStatus = stage
    const saved = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? saved.promise : snapshot())
    await start()
    view.drag(20)
    emit('realtime-flight-state', { ...base, revision: 11 })
    await vi.advanceTimersByTimeAsync(101)
    emit('realtime-flight-state', { ...base, revision: 12 })
    expect(view.clear).not.toHaveBeenCalled()
    expect(view.element.dataset.targetTldt).toBe(at(20))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body))
    expect(body).toMatchObject({ manualTldt: at(20), expectedTargetRevision: 0 })
    saved.resolve(Response.json({ flightState: manual(13, 20) }))
    await vi.advanceTimersByTimeAsync(30)
    expect(view.clear).not.toHaveBeenCalled()
    expect(view.element.dataset.sharedRevision).toBe('13')
    expect(view.element.dataset.sharedTargetRevision).toBe('1')
  })

  it('does not roll a newer WebSocket commit back to an older in-flight poll', async () => {
    const view = row(), poll = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(snapshot()).mockReturnValueOnce(poll.promise)
    await start()
    emit('force-shared-refresh', {})
    emit('realtime-flight-state', manual(13, 20))
    await vi.advanceTimersByTimeAsync(20)
    poll.resolve(snapshot({ ...base, revision: 12 }))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(20))
    expect(view.element.dataset.sharedRevision).toBe('13')
    expect(view.clear).not.toHaveBeenCalled()
  })

  it('ignores a stale Frozen response after the manual commit', async () => {
    const view = row(), frozen = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? frozen.promise : snapshot())
    await start()
    emit('frozen-target-request', { airport: 'VTBS', callsign: 'RACE1', runway: '19', approachCategory: 'C', distanceNm: 9, trackAt: at(0) })
    emit('realtime-flight-state', manual(13, 20))
    await vi.advanceTimersByTimeAsync(20)
    frozen.resolve(Response.json({ flightState: { ...base, revision: 12, frozen_tldt: at(15) } }))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.targetTldt).toBe(at(20))
    expect(view.clear).not.toHaveBeenCalled()
  })

  it('does not apply a stale animation-frame callback after a newer AUTO commit', async () => {
    const view = row()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(snapshot())
    await start()
    emit('realtime-flight-state', manual(11, 20))
    emit('realtime-flight-state', { ...base, revision: 12, target_revision: 2 })
    await vi.advanceTimersByTimeAsync(30)
    expect(view.move).not.toHaveBeenCalled()
    expect(view.element.dataset.sharedRevision).toBe('12')
  })

  it('keeps the second released position while the first save finishes', async () => {
    const view = row(), first = deferred<Response>(), second = deferred<Response>()
    let writes = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? (++writes === 1 ? first.promise : second.promise) : snapshot())
    await start()
    view.drag(20); await vi.advanceTimersByTimeAsync(101)
    view.drag(25); await vi.advanceTimersByTimeAsync(101)
    first.resolve(Response.json({ flightState: manual(11, 20) }))
    await vi.advanceTimersByTimeAsync(30)
    expect(view.element.dataset.targetTldt).toBe(at(25))
    const commands = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)))
    expect(commands).toHaveLength(2)
    expect(commands[1]).toMatchObject({ manualTldt: at(25), expectedTargetRevision: 1 })
    second.resolve(Response.json({ flightState: manual(12, 25, 2) }))
    await vi.advanceTimersByTimeAsync(30)
    expect(view.element.dataset.targetTldt).toBe(at(25))
    expect(view.element.dataset.sharedTargetRevision).toBe('2')
  })

  it('protects the secondary screen release from telemetry until an actual target commit', async () => {
    const view = row()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(snapshot())
    await start()
    emit('realtime-manual-release', { airport: 'VTBS', callsign: 'RACE1', previewId: 'remote1',
      runway: '19', targetAt: at(20), originalTargetAt: at(10), originalRunway: '19' })
    await vi.advanceTimersByTimeAsync(20)
    emit('realtime-flight-state', { ...base, revision: 12 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(view.clear).not.toHaveBeenCalled()
    expect(view.element.dataset.targetTldt).toBe(at(20))
    emit('realtime-flight-state', manual(13, 20))
    await vi.advanceTimersByTimeAsync(20)
    expect(view.element.dataset.sharedRevision).toBe('13')
    expect(view.element.dataset.realtimeReleasePreview).toBeUndefined()
  })
})
