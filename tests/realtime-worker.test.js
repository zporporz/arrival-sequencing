import { afterEach, describe, expect, it, vi } from 'vitest'
import { AmanRealtimeRoom, DRAG_LOCK_TTL_MS } from '../realtime-worker/src/index.js'

class FakeStorage {
  values = new Map()
  puts = []
  alarm = null
  async getAlarm() { return this.alarm }
  async setAlarm(value) { this.alarm = value }

  async get(key) {
    return this.values.get(key)
  }

  async put(key, value) {
    this.puts.push(key)
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
    this.meta = { ...meta, sessionId: meta.vid, expiresAt: Date.now() + 86400000 }
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
  it('rejects forged browser commits even with a maximum revision', async () => {
    const { room, sockets, storage } = setupRoom()
    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'flight_commit', flightState: { airport: 'VTBS', callsign: 'THA123', revision: Number.MAX_SAFE_INTEGER } }))
    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'sequence_commit', sequenceOrder: { airport: 'VTBS', runway: '19', revision: Number.MAX_SAFE_INTEGER } }))
    expect(storage.values.size).toBe(0)
    await room.fetch(new Request('https://aman.internal/authority', { method: 'POST', body: JSON.stringify({ type: 'flight_commit', flightState: { airport: 'VTBS', callsign: 'THA123', revision: 1 } }) }))
    expect(await storage.get('flight:THA123')).toMatchObject({ revision: 1 })
  })

  it('does not roll a newer released preview back when an earlier drag finishes saving', async () => {
    const { room, sockets, storage } = setupRoom()
    await storage.put('pending:THA123', { previewId: 'newer', targetAt: '2026-08-25T10:30:00.000Z' })
    await room.publishCommitted({ type: 'flight_commit', flightState: { airport: 'VTBS', callsign: 'THA123', revision: 1, target_mode: 'MANUAL', manual_tldt: '2026-08-25T10:20:00.000Z' } })
    expect(sockets[1].sent).toHaveLength(0)
    expect(await storage.get('pending:THA123')).toMatchObject({ previewId: 'newer' })
    await room.publishCommitted({ type: 'flight_commit', flightState: { airport: 'VTBS', callsign: 'THA123', revision: 2, target_mode: 'MANUAL', manual_tldt: '2026-08-25T10:30:00.000Z' } })
    expect(sockets[1].sent.at(-1)).toMatchObject({ type: 'flight_commit', previewId: 'newer' })
  })

  it('expires sockets for both sending and receiving, including silent sockets', async () => {
    const { room, sockets, storage } = setupRoom()
    sockets[0].meta.expiresAt = Date.now() - 1
    const close = vi.spyOn(sockets[0], 'close')
    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'drag_begin', callsign: 'THA123' }))
    await room.alarm()
    room.broadcast({ type: 'test' })
    expect(close).toHaveBeenCalledWith(4001, 'Session expired')
    expect(sockets[0].sent).toHaveLength(0)
    expect(await storage.get('lock:THA123')).toBeUndefined()
    expect(sockets[1].sent.at(-1)).toMatchObject({ type: 'test' })
  })

  it('revokes logout sessions and refuses subsequent renewal', async () => {
    const { room, sockets } = setupRoom()
    const command = type => room.fetch(new Request('https://aman.internal/authority', { method: 'POST', body: JSON.stringify({ type, sessionId: '111', expiresAt: Date.now() + 60000 }) }))
    expect((await command('revoke_session')).status).toBe(204)
    expect(sockets[0].meta.revoked).toBe(true)
    expect((await command('renew_session')).status).toBe(401)
    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'drag_begin', callsign: 'THA123' }))
    expect(sockets[0].sent).toHaveLength(0)
  })
  it('keeps a newer flight commit when an older revision arrives late', async () => {
    const { room, sockets, storage } = setupRoom()
    const current = { airport: 'VTBS', callsign: 'THA123', revision: 10 }
    const stale = { airport: 'VTBS', callsign: 'THA123', revision: 9 }

    await room.publishCommitted({ type: 'flight_commit', flightState: current })
    await room.publishCommitted({ type: 'flight_commit', flightState: stale })

    expect(await storage.get('flight:THA123')).toEqual(current)
    expect(sockets[1].sent.at(-1)).toMatchObject({
      type: 'flight_commit', flightState: current,
    })
  })

  it('identifies which drag preview produced a flight commit', async () => {
    const { room, sockets } = setupRoom()
    const state = { airport: 'VTBS', callsign: 'THA123', revision: 1 }

    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))
    await room.webSocketMessage(sockets[0], JSON.stringify({ type: 'drag_release', callsign: 'THA123', previewId: 'preview-one', targetAt: '2026-08-25T10:20:00.000Z', runway: '19' }))
    await room.publishCommitted({ type: 'flight_commit', flightState: { ...state, manual_tldt: '2026-08-25T10:20:00.000Z' } })

    expect(sockets[1].sent.find((message) => message.type === 'flight_commit')).toMatchObject({
      previewId: 'preview-one',
      flightState: state,
    })
  })

  it('broadcasts a validated drag release before persistence completes', async () => {
    const { room, sockets, storage } = setupRoom()
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))

    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_release', callsign: 'THA123', previewId: 'preview-one',
      targetAt: '2026-08-25T10:20:00.000Z', runway: '19',
    }))

    expect(sockets[1].sent.find((message) => message.type === 'drag_release')).toMatchObject({
      airport: 'VTBS', callsign: 'THA123', previewId: 'preview-one',
      targetAt: '2026-08-25T10:20:00.000Z', runway: '19',
    })
    expect(await storage.get('pending:THA123')).toMatchObject({
      type: 'drag_release', previewId: 'preview-one', targetAt: '2026-08-25T10:20:00.000Z',
    })
  })

  it('does not persist the same drag lock on every preview frame', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-25T10:00:00.000Z')
    const { room, sockets, storage } = setupRoom()
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))

    for (let index = 0; index < 20; index += 1) {
      await room.webSocketMessage(sockets[0], JSON.stringify({
        type: 'drag_preview', callsign: 'THA123', previewId: 'preview-one',
        rows: [{ callsign: 'THA123', targetAt: '2026-08-25T10:20:00.000Z', runway: '19' }],
      }))
    }

    expect(storage.puts.filter((key) => key === 'lock:THA123')).toHaveLength(1)
    vi.advanceTimersByTime(3_100)
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_preview', callsign: 'THA123', previewId: 'preview-one',
      rows: [{ callsign: 'THA123', targetAt: '2026-08-25T10:21:00.000Z', runway: '19' }],
    }))
    expect(storage.puts.filter((key) => key === 'lock:THA123')).toHaveLength(2)
  })

  it('removes a pending release after the Supabase-backed commit arrives', async () => {
    const { room, sockets, storage } = setupRoom()
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_begin', callsign: 'THA123', previewId: 'preview-one',
    }))
    await room.webSocketMessage(sockets[0], JSON.stringify({
      type: 'drag_release', callsign: 'THA123', previewId: 'preview-one',
      targetAt: '2026-08-25T10:20:00.000Z', runway: '19',
    }))
    await room.publishCommitted({
      type: 'flight_commit', flightState: { airport: 'VTBS', callsign: 'THA123', revision: 1, manual_tldt: '2026-08-25T10:20:00.000Z' },
    })

    expect(await storage.get('pending:THA123')).toBeUndefined()
  })

  it('keeps a newer sequence commit when an older revision arrives late', async () => {
    const { room, sockets, storage } = setupRoom()
    const current = { airport: 'VTBS', runway: '19', ordered_callsigns: ['A', 'B'], revision: 8 }
    const stale = { airport: 'VTBS', runway: '19', ordered_callsigns: ['B', 'A'], revision: 7 }

    await room.publishCommitted({ type: 'sequence_commit', sequenceOrder: current })
    await room.publishCommitted({ type: 'sequence_commit', sequenceOrder: stale })

    expect(await storage.get('sequence:19')).toEqual(current)
    expect(sockets[1].sent.at(-1)).toMatchObject({ type: 'sequence_commit', sequenceOrder: current })
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
