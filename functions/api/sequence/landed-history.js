import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

const AIRPORT_REFERENCE = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.6811, lon: 100.7473 },
};
const TERMINAL_STATES = new Set(['landed', 'on blocks', 'on ground', 'taxi', 'taxiing', 'parking']);
const CAPTURE_RADIUS_NM = 5;
const MAX_HISTORY_MINUTES = 20;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function cleanAirport(value) {
  const airport = String(value || '').trim().toUpperCase();
  return AIRPORT_REFERENCE[airport] ? airport : null;
}

function cleanCallsign(value) {
  const callsign = String(value || '').trim().toUpperCase();
  return callsign ? callsign.slice(0, 20) : null;
}

function finite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function toRadians(value) { return value * Math.PI / 180; }
function distanceNm(lat1, lon1, lat2, lon2) {
  const r = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function airlineAircraft(pilot) {
  return String(pilot?.flightPlan?.aircraftId || pilot?.flightPlan?.aircraft?.icaoCode || '').trim().toUpperCase() || null;
}

function timestampMs(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

// IVAO may assign a new raw session id after a reconnect while the aircraft is
// still on the ground. Keep the first observed landing time, but retain the
// freshest session/snapshot so missed-approach validation uses the live track.
export function collapseDuplicateLandings(records) {
  const collapsed = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const airport = String(record?.airport || '').trim().toUpperCase();
    const callsign = String(record?.callsign || '').trim().toUpperCase();
    if (!airport || !callsign) continue;

    const key = `${airport}:${callsign}`;
    const existing = collapsed.get(key);
    if (!existing) {
      collapsed.set(key, record);
      continue;
    }

    const existingLandedMs = timestampMs(existing.landed_at);
    const recordLandedMs = timestampMs(record.landed_at);
    const earliestLandedAt = recordLandedMs < existingLandedMs ? record.landed_at : existing.landed_at;
    const existingFreshness = Math.max(timestampMs(existing.last_seen_at), existingLandedMs);
    const recordFreshness = Math.max(timestampMs(record.last_seen_at), recordLandedMs);
    const freshest = recordFreshness > existingFreshness ? record : existing;

    collapsed.set(key, { ...freshest, landed_at: earliestLandedAt });
  }

  return [...collapsed.values()].sort((left, right) => timestampMs(right.landed_at) - timestampMs(left.landed_at));
}

async function suppressedCallsigns(env, serviceDate, airport) {
  try {
    const result = await supabaseAdminRequest(
      env,
      `aman_flight_states?select=callsign,operational_state,target_mode,manual_tldt&service_date=eq.${encodeURIComponent(serviceDate)}&airport=eq.${encodeURIComponent(airport)}`,
    );
    const nowMs = Date.now();
    return new Set((result.data || [])
      .filter((row) => {
        const operational = String(row?.operational_state || 'NORMAL').toUpperCase();
        if (operational !== 'NORMAL') return true;

        // A future MANUAL target on a flight that has just been reinserted after a
        // missed approach protects it from being immediately captured as LANDED again
        // while IVAO still reports rollout/taxi near the airport.
        if (String(row?.target_mode || '').toUpperCase() !== 'MANUAL' || !row?.manual_tldt) return false;
        const targetMs = new Date(row.manual_tldt).getTime();
        return Number.isFinite(targetMs) && targetMs > nowMs;
      })
      .map((row) => String(row.callsign || '').trim().toUpperCase())
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

async function captureCurrentLanded(env, airport) {
  if (!env.IVAO_API_KEY) return;
  const response = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
    headers: { apiKey: env.IVAO_API_KEY, Accept: 'application/json' },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!response.ok) return;
  const data = await response.json();
  const pilots = Array.isArray(data?.clients?.pilots) ? data.clients.pilots : [];
  const reference = AIRPORT_REFERENCE[airport];
  const nowIso = new Date().toISOString();
  const serviceDate = nowIso.slice(0, 10);
  const blockedCallsigns = await suppressedCallsigns(env, serviceDate, airport);
  const rows = [];

  for (const pilot of pilots) {
    const fp = pilot?.flightPlan || {};
    const track = pilot?.lastTrack || {};
    if (String(fp.arrivalId || '').trim().toUpperCase() !== airport) continue;
    const state = String(track.state || '').trim().toLowerCase();
    if (track.onGround !== true && !TERMINAL_STATES.has(state)) continue;
    const lat = finite(track.latitude, track.lat, pilot.latitude, pilot.lat);
    const lon = finite(track.longitude, track.lon, track.lng, pilot.longitude, pilot.lon, pilot.lng);
    if (lat == null || lon == null || distanceNm(reference.lat, reference.lon, lat, lon) > CAPTURE_RADIUS_NM) continue;

    const sessionId = String(pilot.id ?? '').trim();
    const callsign = String(pilot.callsign || '').trim().toUpperCase();
    if (!sessionId || !callsign || blockedCallsigns.has(callsign)) continue;
    const trackMs = new Date(track.timestamp || '').getTime();
    const landedAt = Number.isFinite(trackMs) ? new Date(trackMs).toISOString() : nowIso;
    rows.push({
      service_date: serviceDate,
      airport,
      callsign,
      raw_session_id: sessionId,
      vid: pilot.userId != null ? String(pilot.userId) : null,
      aircraft_type: airlineAircraft(pilot),
      departure: String(fp.departureId || '').trim().toUpperCase() || null,
      arrival: airport,
      route: String(fp.route || '').trim().toUpperCase() || null,
      landed_at: landedAt,
      last_seen_at: nowIso,
      snapshot: {
        sessionId,
        callsign,
        aircraft: airlineAircraft(pilot),
        departure: String(fp.departureId || '').trim().toUpperCase() || null,
        arrival: airport,
        route: String(fp.route || '').trim().toUpperCase() || null,
        state: track.state || 'LANDED',
        onGround: true,
        trackTimestamp: track.timestamp || landedAt,
        altitude: finite(track.altitude, pilot.altitude),
        groundSpeed: finite(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
        latitude: lat,
        longitude: lon,
        heading: finite(track.heading, track.course, pilot.heading),
      },
    });
  }

  if (rows.length) {
    await supabaseAdminRequest(env, 'aman_landed_history?on_conflict=service_date,airport,callsign,raw_session_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const airport = cleanAirport(url.searchParams.get('airport'));
    if (!airport) return json({ error: 'VTBD or VTBS airport is required' }, 400);

    await captureCurrentLanded(context.env, airport);
    const cutoff = new Date(Date.now() - MAX_HISTORY_MINUTES * 60_000).toISOString();
    const serviceDate = new Date().toISOString().slice(0, 10);
    const result = await supabaseAdminRequest(
      context.env,
      `aman_landed_history?select=*&service_date=eq.${serviceDate}&airport=eq.${airport}&landed_at=gte.${encodeURIComponent(cutoff)}&order=landed_at.desc`,
    );

    return json({
      airport,
      fetchedAt: new Date().toISOString(),
      flights: collapseDuplicateLandings(result.data || []),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const action = String(payload?.action || '').trim();
    if (action !== 'dismissLanded') return json({ error: 'Unsupported landed-history action' }, 400);

    const airport = cleanAirport(payload.airport);
    const callsign = cleanCallsign(payload.callsign);
    if (!airport || !callsign) return json({ error: 'Airport and callsign are required' }, 400);

    const serviceDate = new Date().toISOString().slice(0, 10);
    await supabaseAdminRequest(
      context.env,
      `aman_landed_history?service_date=eq.${encodeURIComponent(serviceDate)}&airport=eq.${encodeURIComponent(airport)}&callsign=eq.${encodeURIComponent(callsign)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      },
    );

    return json({ ok: true, airport, callsign });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
