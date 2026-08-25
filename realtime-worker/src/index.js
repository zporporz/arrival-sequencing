const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_AUTO_ROWS = 300;
const MAX_PREVIEW_ROWS = 100;

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

    const [autoSnapshot, committedFlights, sequenceOrders] = await Promise.all([
      this.ctx.storage.get('autoSnapshot'),
      this.ctx.storage.list({ prefix: 'flight:' }),
      this.ctx.storage.list({ prefix: 'sequence:' }),
    ]);
    this.send(server, {
      type: 'room_snapshot',
      airport,
      serviceDate,
      autoSnapshot: autoSnapshot || null,
      flightStates: [...committedFlights.values()],
      sequenceOrders: [...sequenceOrders.values()],
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

    if (payload?.type === 'drag_preview' && Array.isArray(payload.rows)) {
      const previewId = cleanText(payload.previewId, 80) || crypto.randomUUID();
      const rows = payload.rows.slice(0, MAX_PREVIEW_ROWS).map((item) => ({
        callsign: cleanText(item?.callsign, 20).toUpperCase(),
        targetAt: cleanIso(item?.targetAt),
        runway: cleanText(item?.runway, 12).toUpperCase(),
      })).filter((item) => item.callsign && item.targetAt);
      meta.previewId = previewId;
      socket.serializeAttachment(meta);
      this.broadcast({
        type: 'drag_preview', airport: meta.airport, previewId, rows,
        actor: { vid: meta.vid, name: meta.name },
      }, meta.clientId);
      return;
    }

    if (payload?.type === 'drag_cancel') {
      const previewId = cleanText(payload.previewId, 80) || meta.previewId;
      meta.previewId = '';
      socket.serializeAttachment(meta);
      if (previewId) this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId }, meta.clientId);
      return;
    }

    if (payload?.type === 'flight_commit' && payload.flightState) {
      const state = payload.flightState;
      const callsign = cleanText(state.callsign, 20).toUpperCase();
      if (!callsign || cleanAirport(state.airport) !== meta.airport) return;
      await this.ctx.storage.put(`flight:${callsign}`, state);
      meta.previewId = '';
      socket.serializeAttachment(meta);
      this.broadcast({ type: 'flight_commit', airport: meta.airport, flightState: state });
      return;
    }

    if (payload?.type === 'sequence_commit' && payload.sequenceOrder) {
      const order = payload.sequenceOrder;
      const runway = cleanText(order.runway, 12).toUpperCase();
      if (!runway || cleanAirport(order.airport) !== meta.airport) return;
      await this.ctx.storage.put(`sequence:${runway}`, order);
      this.broadcast({ type: 'sequence_commit', airport: meta.airport, sequenceOrder: order });
    }
  }

  async webSocketClose(socket, code, reason) {
    const meta = socketMeta(socket);
    if (meta.previewId) {
      this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId: meta.previewId }, meta.clientId);
    }
    try { socket.close(code, reason); } catch { /* already closed */ }
    queueMicrotask(() => this.announceRoles(meta.clientId));
  }

  async webSocketError(socket) {
    const meta = socketMeta(socket);
    if (meta.previewId) {
      this.broadcast({ type: 'drag_cancel', airport: meta.airport, previewId: meta.previewId }, meta.clientId);
    }
    queueMicrotask(() => this.announceRoles(meta.clientId));
  }
}

export default {
  fetch() {
    return new Response('AMAN realtime Durable Object worker', { status: 404 });
  },
};
