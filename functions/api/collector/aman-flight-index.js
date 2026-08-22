import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

const AIRPORTS = new Set(['VTBD', 'VTBS']);
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function cleanUpper(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function cleanIso(value, fallback) {
  const millis = new Date(String(value || '')).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : fallback;
}

function aircraftType(pilot) {
  const fp = pilot?.flightPlan || {};
  const aircraft = fp?.aircraft || {};
  return cleanUpper(fp.aircraftId) || cleanUpper(aircraft.icaoCode) || null;
}

async function readCollectorToken(env) {
  const result = await supabaseAdminRequest(
    env,
    'aman_collector_state?select=collector_token&collector_key=eq.ivao-flight-index&limit=1',
  );
  return String(result.data?.[0]?.collector_token || '').trim();
}

async function claimCollector(env) {
  const result = await supabaseAdminRequest(env, 'rpc/claim_aman_flight_index_collector', {
    method: 'POST',
    body: JSON.stringify({ min_interval_seconds: 45 }),
  });
  return result.data === true;
}

async function updateCollectorState(env, patch) {
  await supabaseAdminRequest(env, 'aman_collector_state?collector_key=eq.ivao-flight-index', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function fetchWhazzup(env) {
  if (!env.IVAO_API_KEY) throw new Error('IVAO_API_KEY is not configured');
  const response = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
    headers: { apiKey: env.IVAO_API_KEY, Accept: 'application/json' },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`IVAO whazzup returned ${response.status}`);
  return response.json();
}

function buildRows(data, fetchedAt) {
  const pilots = Array.isArray(data?.clients?.pilots) ? data.clients.pilots : [];
  const rows = [];

  for (const pilot of pilots) {
    const fp = pilot?.flightPlan || {};
    const arrival = cleanUpper(fp.arrivalId);
    if (!AIRPORTS.has(arrival)) continue;

    const flightRules = cleanUpper(fp.rules);
    if (flightRules === 'V' || flightRules === 'VFR') continue;

    const sessionId = String(pilot?.id ?? '').trim();
    const callsign = cleanUpper(pilot?.callsign);
    if (!sessionId || !callsign) continue;

    const track = pilot?.lastTrack || {};
    const trackAt = cleanIso(track.timestamp, null);
    const seenAt = trackAt || fetchedAt;

    rows.push({
      session_id: sessionId,
      service_date: seenAt.slice(0, 10),
      airport: arrival,
      callsign,
      departure: cleanUpper(fp.departureId),
      arrival,
      aircraft_type: aircraftType(pilot),
      first_seen_at: seenAt,
      last_seen_at: fetchedAt,
      last_track_at: trackAt,
      last_state: track.state ? String(track.state).trim() : null,
      // Intentionally do not store route, position, GS, altitude, heading or track history.
      // IVAO remains the source for historical track replay when diagnosis is needed.
      _gs_check: finiteNumber(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
    });
  }

  return rows.map(({ _gs_check, ...row }) => row);
}

export async function onRequestPost(context) {
  const suppliedToken = String(context.request.headers.get('x-collector-token') || '').trim();
  try {
    const expectedToken = await readCollectorToken(context.env);
    if (!expectedToken || suppliedToken !== expectedToken) return json({ error: 'Unauthorized collector request' }, 401);

    const claimed = await claimCollector(context.env);
    if (!claimed) return json({ ok: true, skipped: 'collector already ran recently' });

    const fetchedAt = new Date().toISOString();
    const data = await fetchWhazzup(context.env);
    const rows = buildRows(data, fetchedAt);

    const result = await supabaseAdminRequest(context.env, 'rpc/upsert_aman_flight_index', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });

    await updateCollectorState(context.env, {
      last_success_at: fetchedAt,
      last_error: null,
    });

    return json({ ok: true, fetchedAt, rows: rows.length, affected: Number(result.data || 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await updateCollectorState(context.env, { last_error: message.slice(0, 1000) });
    } catch {}
    return json({ error: message }, 500);
  }
}
