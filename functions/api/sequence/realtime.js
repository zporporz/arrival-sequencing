const json = (body, status) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

export async function onRequestGet(context) {
  const upgrade = context.request.headers.get('Upgrade') || '';
  if (upgrade.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required' }, 426);
  if (!context.env.AMAN_REALTIME) return json({ error: 'AMAN realtime binding is not configured' }, 503);

  const url = new URL(context.request.url);
  const airport = String(url.searchParams.get('airport') || '').trim().toUpperCase();
  const serviceDate = String(url.searchParams.get('serviceDate') || '').trim();
  if (!/^(VTBD|VTBS)$/.test(airport) || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return json({ error: 'Valid serviceDate and airport are required' }, 400);
  }

  const headers = new Headers(context.request.headers);
  headers.set('X-AMAN-VID', String(context.data.auth?.vid || ''));
  headers.set('X-AMAN-Name', String(context.data.auth?.name || context.data.auth?.vid || 'IVAO'));
  const roomRequest = new Request(context.request.url, { method: 'GET', headers });
  const room = context.env.AMAN_REALTIME.getByName(`${serviceDate}:${airport}`);
  return room.fetch(roomRequest);
}
