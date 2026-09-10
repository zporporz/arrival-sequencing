import { sessionMaxAgeSeconds, SESSION_IDLE_TIMEOUT_SECONDS } from './session.js';

export function realtimeSession(session) {
  return {
    sessionId: `${session.vid}:${session.createdAt}`,
    expiresAt: Math.min(new Date(session.createdAt).getTime() + sessionMaxAgeSeconds(session) * 1000,
      new Date(session.lastActivityAt || session.createdAt).getTime() + SESSION_IDLE_TIMEOUT_SECONDS * 1000),
  };
}

// Only server-side bindings can reach this endpoint. The Worker's public fetch
// never forwards requests to a room.
export async function roomCommand(env, date, airport, body) {
  if (!env.AMAN_REALTIME) return;
  const response = await env.AMAN_REALTIME.getByName(`v2:${date}:${airport}`).fetch(new Request('https://aman.internal/authority', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  if (!response.ok) throw new Error('Realtime authority update failed');
}

export async function updateRealtimeSession(env, session, revoke = false) {
  if (!env.AMAN_REALTIME) return;
  const dates = [0, 1].map(days => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
  await Promise.all(dates.flatMap(date => ['VTBD', 'VTBS', 'VTCC', 'VTSP'].map(airport => roomCommand(env, date, airport, {
    type: revoke ? 'revoke_session' : 'renew_session', ...realtimeSession(session),
  }))));
}
