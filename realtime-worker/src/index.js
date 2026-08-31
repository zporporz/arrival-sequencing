const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_AUTO_ROWS = 300;
const MAX_PREVIEW_ROWS = 100;
export const DRAG_LOCK_TTL_MS = 5_000;

function cleanText(value, max = 120) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

function cleanAirport(value) {
  const airport = cleanText(value, 4).toUpperCase();
  return /^(VTBD|VTBS)$/.test(airport) ? airport : '';
}

function cleanIso(value) {
  const millis = new Date(String(value ?? '')).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : '';
}

function socketMeta(socket) {
  try { return socket.deserializeAttachment() || {}; } catch { return {}; }
}

export function commitRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

export function incomingCommitIsNewer(incoming, current) {
  const incomingRevision = commitRevision(incoming?.revision);
  return incomingRevision > 0 && incomingRevision > commitRevision(current?.revision);
}

export class AmanRealtimeRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  sockets() {
    return this.ctx.getWebSockets();
  }

  leaderId(excludeClientId = '') {
    return this.sockets()
      .map((socket) => socketMeta(socket))
      .filter((meta) => meta.clientId && meta.clientId !== excludeClientId)
      .sort((left, right) => Number(left.joinedAt) - Number(right.joinedAt))[0]?.clientId || '';
  }

  send(socket, body) {
    try { socket.send(JSON.stringify(body)); } catch { /* disconnected */ }
  }

  broadcast(body, exceptClientId = '') {
    const encoded = JSON.stringify(body);
    for (const socket of this.sockets()) {
      if (exceptClientId && socketMeta(socket).clientId === exceptClientId) continue;
      try { socket.send(encoded); } catch { /* disconnected */ }
    }
  }

  announceRoles(excludeClientId = '') {
    const leaderId = this.leaderId(excludeClientId);
    for (const socket of this.sockets()) {
      const meta = socketMeta(socket);
      if (meta.clientId === excludeClientId) continue;
      this.send(socket, { type: 'role', leader: meta.clientId === leaderId });
    }
  }

  lockKey(callsign) {
    return `lock:${callsign}`;
  }

  async activeDragLocks() {
    const now = Date.now();
    const stored = await this.ctx.storage.list({ prefix: 'lock:' });
    const active = [];
    for (const [key, lock] of stored) {
      if (Number(lock?.expiresAt) > now) {
        active.push({
          callsign: lock.callsign,
          previewId: lock.previewId,
          actor: lock.actor,
          expiresAt: lock.expiresAt,
        });
      }
      else await this.ctx.storage.delete(key);
    }
    return active;
  }

  async acquireDragLock(socket, meta, callsign, previewId) {
    const key = this.lockKey(callsign);
    const now = Date.now();
    const existing = await this.ctx.storage.get(key);
    if (existing && Number(existing.expiresAt) > now && existing.clientId !== meta.clientId) {
      this.send(socket, {
        type: 'drag_denied',
        airport: meta.airport,
        callsign,
        previewId,
        actor: existing.actor,
        expiresAt: existing.expiresAt,
      });
      return null;
    }
    const alreadyOwned = existing?.clientId === meta.clientId && existing?.previewId === previewId;

    const lock = {
      callsign,
      previewId,
      clientId: meta.clientId,
      actor: { vid: meta.vid, name: meta.name },
      expiresAt: now + DRAG_LOCK_TTL_MS,
    };
    await this.ctx.storage.put(key, lock);
    meta.previewId = previewId;
    meta.dragCallsign = callsign;
    socket.serializeAttachment(meta);
    if (!alreadyOwned) this.send(socket, { type: 'drag_granted', airport: meta.airport, ...lock, clientId: undefined });
    this.broadcast({ type: 'drag_lock', airport: meta.airport, ...lock, clientId: undefined }, meta.clientId);
    return lock;
  }

  async releaseDragLock(socket, meta, previewId = '') {
    const callsign = cleanText(meta.dragCallsign, 20).toUpperCase();
    if (!callsign) return;
    const key = this.lockKey(callsign);
    const lock = await this.ctx.storage.get(key);
    const ownsLock = lock?.clientId === meta.clientId && (!previewId || lock.previewId === previewId);
    if (ownsLock) {
      await this.ctx.storage.delete(key);
      this.broadcast({ type: 'drag_unlock', airport: meta.airport, callsign, previewId: lock.previewId }, meta.clientId);
    }
    if (!previewId || meta.previewId === previewId) {
      meta.previewId = '';
      meta.dragCallsign = '';
      socket.serializeAttachment(meta);
    }
  }

  rejectStaleCommit(socket, entity, current) {
    this.send(socket, {
      type: 'commit_rejected',
      entity,
      reason: 'STALE_REVISION',
      current: current || null,
    });
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    const url = new URL(request.url);
    const airport = cleanAirport(url.searchParams.get('airport'));
    const serviceDate = cleanText(url.searchParams.get('serviceDate'), 10);
    const vid = cleanText(request.headers.get('X-AMAN-VID'), 32);
    if (!airport || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !vid) {
      return new Response('Invalid authenticated AMAN room request', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const meta = {
      clientId: crypto.randomUUID(),
      vid,
      name: cleanText(request.headers.get('X-AMAN-Name'), 120) || vid,
      airport,
      serviceDate,
      joinedAt: Date.now(),
      previewId: '',
    };
    server.serializeAttachment(meta);
    this.ctx.acceptWebSocket(server);

    const [autoSnapshot, committedFlights, sequenceOrders, dragLocks] = await Promise.all([
      this.ctx.storage.get('autoSnapshot'),
      this.ctx.storage.list({ prefix: 'flight:' }),
      this.ctx.storage.list({ prefix: 'sequence:' }),
      this.activeDragLocks(),
    ]);
    this.send(server, {
      type: 'room_snapshot',
      airport,
      serviceDate,
      autoSnapshot: autoSnapshot || null,
      flightStates: [...committedFlights.values()],
      sequenceOrders: [...sequenceOrders.values()],
      dragLocks,
    });
    queueMicrotask(() => this.announceRoles());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return;
    let payload;
    try { payload = JSON.parse(message); } catch { return; }
    const meta = socketMeta(socket);
    if (!meta.clientId) return;

    if (payload?.type === 'auto_snapshot') {
      if (meta.clientId !== this.leaderId() || !Array.isArray(payload.arrivals)) return;
      const arrivals = payload.arrivals.slice(0, MAX_AUTO_ROWS).map((item) => ({
        id: cleanText(item?.id, 180),
        predictedIawpAt: cleanIso(item?.predictedIawpAt),
      })).filter((item) => item.id && item.predictedIawpAt);
      const previous = await this.ctx.storage.get('autoSnapshot');
      const snapshot = {
        revision: Number(previous?.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
        arrivals,
      };
      await this.ctx.storage.put('autoSnapshot', snapshot);
      this.broadcast({ type: 'auto_snapshot', airport: meta.airport, ...snapshot });
      return;
    }

    if (payload?.type === 'drag_begin') {
      const callsign = cleanText(payload.callsign, 20).toUpperCase();
      const previewId = cleanText(payload.previewId, 80) || crypto.randomUUID();
      if (!callsign) return;
      if (meta.dragCallsign && meta.dragCallsign !== callsign) await this.releaseDragLock(socket, meta);
      await this.acquireDragLock(socket, meta, callsign, previewId);
      return;
    }

    if (payload?.type === 'drag_preview' && Array.isArray(payload.rows)) {
      const previewId = cleanText(payload.previewId, 80) || crypto.randomUUID();
      const callsign = cleanText(payload.callsign, 20).toUpperCase();
      if (!callsign) return;
      const lock = await this.acquireDragLock(socket, meta, callsign, previewId);
      if (!lock) return;
      const rows = payload.rows.slice(0, MAX_PREVIEW_ROWS).map((item) => ({
        callsign: cleanText(item?.callsign, 20).toUpperCase(),
        targetAt: cleanIso(item?.targetAt),
        runway: cleanText(item?.runway, 12).toUpperCase(),
      })).filter((item) => item.callsign && item.targetAt);
      this.broadcast({
        type: 'drag_preview', airport: meta.airport, previewId, rows,
        callsign, actor: lock.actor, expiresAt: lock.expiresAt,
      }, meta.clientId);
      return;
    }

    if (payload?.type === 'drag_cancel') {
      const previewId = cleanText(payload.previewId, 80) || meta.previewId;
      await this.releaseDragLock(socket, meta, previewId);
      if (previewId) this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId }, meta.clientId);
      return;
    }

    if (payload?.type === 'flight_commit' && payload.flightState) {
      const state = payload.flightState;
      const callsign = cleanText(state.callsign, 20).toUpperCase();
      if (!callsign || cleanAirport(state.airport) !== meta.airport) return;
      const key = `flight:${callsign}`;
      const current = await this.ctx.storage.get(key);
      if (!incomingCommitIsNewer(state, current)) {
        this.rejectStaleCommit(socket, 'flight', current);
        return;
      }
      const previewId = cleanText(meta.previewId, 80);
      await this.ctx.storage.put(key, state);
      await this.releaseDragLock(socket, meta);
      this.broadcast({ type: 'flight_commit', airport: meta.airport, previewId, flightState: state });
      return;
    }

    if (payload?.type === 'sequence_commit' && payload.sequenceOrder) {
      const order = payload.sequenceOrder;
      const runway = cleanText(order.runway, 12).toUpperCase();
      if (!runway || cleanAirport(order.airport) !== meta.airport) return;
      const key = `sequence:${runway}`;
      const current = await this.ctx.storage.get(key);
      if (!incomingCommitIsNewer(order, current)) {
        this.rejectStaleCommit(socket, 'sequence', current);
        return;
      }
      await this.ctx.storage.put(key, order);
      this.broadcast({ type: 'sequence_commit', airport: meta.airport, sequenceOrder: order });
    }
  }

  async webSocketClose(socket, code, reason) {
    const meta = socketMeta(socket);
    const previewId = meta.previewId;
    await this.releaseDragLock(socket, meta);
    if (previewId) {
      this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId }, meta.clientId);
    }
    try { socket.close(code, reason); } catch { /* already closed */ }
    queueMicrotask(() => this.announceRoles(meta.clientId));
  }

  async webSocketError(socket) {
    const meta = socketMeta(socket);
    const previewId = meta.previewId;
    await this.releaseDragLock(socket, meta);
    if (previewId) {
      this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId }, meta.clientId);
    }
    queueMicrotask(() => this.announceRoles(meta.clientId));
  }
}

export default {
  fetch() {
    return new Response('AMAN realtime Durable Object worker', { status: 404 });
  },
};
