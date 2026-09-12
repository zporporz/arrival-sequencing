import { getRequestSession } from "../../_lib/session.js";
import { roomCommand } from '../../_lib/realtimeAuthority.js';

export async function onRequest(context) {
  const session = await getRequestSession(context.request, context.env);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  context.data.auth = session;
  const response = await context.next();
  if (context.request.method === 'POST' && response.ok && response.headers.get('Content-Type')?.includes('application/json')) {
    const result = await response.clone().json();
    for (const [field, type] of [['flightState', 'flight_commit'], ['sequenceOrder', 'sequence_commit']]) {
      const state = result[field];
      if (!state || !['VTBD', 'VTBS', 'VTCC', 'VTSP'].includes(state.airport)) continue;
      // Publish only the database response, never the browser's claimed commit.
      try { await roomCommand(context.env, state.service_date, state.airport, {
        type, [field]: state, ...(result.snapshotOnly === true ? { snapshotOnly: true } : {}),
      }); }
      catch (error) { console.error('Realtime publish failed; shared-state polling will recover', error); }
    }
  }
  return response;
}
