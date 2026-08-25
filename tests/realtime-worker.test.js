import { afterEach, describe, expect, it, vi } from 'vitest'
import { AmanRealtimeRoom, DRAG_LOCK_TTL_MS } from '../realtime-worker/src/index.js'

class FakeStorage {
  values = new Map()

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.values.set(key, value)
  }

  async delete(key) {
    this.values.delete(key)
  }

  async list({ prefix }) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)))
  }
}

class FakeSocket {
  sent = []

  constructor(meta) {
    this.meta = meta
  }

  deserializeAttachment() {
    return this.meta
  }

  serializeAttachment(meta) {
    this.meta = { ...meta }
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  close() {}
}

function setupRoom() {
  const sockets = [
    new FakeSocket({ clientId: 'one', vid: '111', name: 'ONE', airport: 'VTBS', serviceDate: '2026-08-25', joinedAt: 1 }),
    new FakeSocket({ clientId: 'two', vid: '222', name: 'TWO', airport: 'VTBS', serviceDate: '2026-08-25', joinedAt: 2 }),
  ]
  const storage = new FakeStorage()
  const ctx = { storage, getWebSockets: () => sockets }
  return { room: new AmanRealtimeRoom(ctx, {}), sockets, storage }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AMAN realtime Durable Object coordination', () => {
  it('keeps a newer flight commit when an older revision arrives late', async () => {
    const { room, sockets, storage } = setupRoom()
    const current = { airport: 'VTBS', callsign: 'THA123', revision: 10 }
    const stale = { airport: 'VTBS', callsign: 'THA123', revision: 9 }

    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'flight_commit', flightState: current }))
    await room.webSocketMessage(sockets[1], JSON.stringify({ type: 'flight_commit', flightState: stale }))

    expect(await storage.get('flight:THA123')).toEqual(current)
    expect(sockets[1].sent.at(-1)).toMatchObject({
      type: 'commit_rejected',
      entity: 'flight',
      reason: 'STALE_REVISION',
      current,
    })
  })

  it('keeps a newer sequence commit when an older revision arrives late', async () => {
    const { room, sockets, storage } = setupRoom()
    const current = { airport: 'VTBS', runway: '19', ordered_callsigns: ['A', 'B'], revision: 8 }
    const stale = { airport: 'VTBS', runway: '19', ordered_callsigns: ['B', 'A'], revision: 7 }

    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'sequence_commit', sequenceOrder: current }))
    await room.webSocketMessage(sockets[1], JSON.stringify({ type: 'sequence_commit', sequenceOrder: stale }))

    expect(await storage.get('sequence:19')).toEqual(current)
    expect(sockets[1].sent.at(-1)).toMatchObject({ type: 'commit_rejected', entity: 'sequence', current })
  })

  it('allows only one controller to drag a flight until the five-second lease expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-25T10:00:00.000Z')
    const { room, sockets, storage } = setupRoom()

    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))
    await room.webSocketMessage(sockets[1], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-two',
    }))

    expect(sockets[0].sent.some((message) => message.type === 'drag_granted')).toBe(true)
    expect(sockets[1].sent.at(-1)).toMatchObject({
      type: 'drag_denied', callsign: 'THA123', actor: { vid: '111', name: 'ONE' },
    })
    expect((await storage.get('lock:THA123')).clientId).toBe('one')

    vi.advanceTimersByTime(DRAG_LOCK_TTL_MS + 1)
    await room.webSocketMessage(sockets[1], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-two',
    }))

    expect(sockets[1].sent.at(-1)).toMatchObject({ type: 'drag_granted', callsign: 'THA123' })
    expect((await storage.get('lock:THA123')).clientId).toBe('two')
  })

  it('releases the drag lease when its controller disconnects', async () => {
    const { room, sockets, storage } = setupRoom()
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))

    await room.webSocketClose(sockets[0], 1000, 'closed')

    expect(await storage.get('lock:THA123')).toBeUndefined()
    expect(sockets[1].sent.some((message) => message.type === 'drag_unlock' && message.callsign === 'THA123')).toBe(true)
    expect(sockets[1].sent.some((message) => message.type === 'drag_cancel' && message.previewId === 'preview-one')).toBe(true)
  })
})
