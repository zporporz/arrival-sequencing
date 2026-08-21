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
    if (!sessionId || !callsign) continue;
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
    // The first observed terminal-state sample is the ALDT proxy. Do not merge later
    // taxi/parking samples over the same flight, otherwise landed_at walks forward.
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

    return json({ airport, fetchedAt: new Date().toISOString(), flights: result.data || [] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
