const WHAZZUP_TTL_MS = 15000;
let whazzupCache = { expiresAt: 0, data: null };

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function cleanAirport(value) {
  const airport = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(airport) ? airport : null;
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function airlineIcaoFromCallsign(value) {
  const callsign = String(value || '').trim().toUpperCase();
  const match = callsign.match(/^([A-Z]{3})[A-Z0-9]/);
  return match?.[1] || null;
}

async function getWhazzup(env) {
  if (whazzupCache.data && Date.now() < whazzupCache.expiresAt) return whazzupCache.data;
  if (!env.IVAO_API_KEY) throw new Error('IVAO_API_KEY is not configured');

  const response = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
    headers: { apiKey: env.IVAO_API_KEY },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`IVAO whazzup returned ${response.status}`);
  const data = await response.json();
  whazzupCache = { expiresAt: Date.now() + WHAZZUP_TTL_MS, data };
  return data;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const airport = cleanAirport(url.searchParams.get('airport'));
    if (!airport) return json({ error: 'Valid airport ICAO is required' }, 400);

    const data = await getWhazzup(context.env);
    const pilots = Array.isArray(data?.clients?.pilots) ? data.clients.pilots : [];
    const terminalStates = new Set(['landed', 'on blocks']);

    const flights = pilots
      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport)
      .filter((pilot) => !terminalStates.has(String(pilot?.lastTrack?.state || '').trim().toLowerCase()))
      .map((pilot) => {
        const fp = pilot.flightPlan || {};
        const track = pilot.lastTrack || {};
        return {
          sessionId: String(pilot.id ?? ''),
          vid: pilot.userId != null ? String(pilot.userId) : null,
          callsign: String(pilot.callsign || '').trim().toUpperCase(),
          aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,
          departure: fp.departureId ? String(fp.departureId).trim().toUpperCase() : null,
          arrival: airport,
          route: fp.route ? String(fp.route).trim().toUpperCase() : null,
          state: track.state ? String(track.state).trim() : null,
          altitude: finiteNumber(track.altitude, pilot.altitude),
          groundSpeed: finiteNumber(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
          latitude: finiteNumber(track.latitude, track.lat, pilot.latitude, pilot.lat),
          longitude: finiteNumber(track.longitude, track.lon, track.lng, pilot.longitude, pilot.lon, pilot.lng),
          heading: finiteNumber(track.heading, track.course, pilot.heading),
          connectedAt: pilot.createdAt || null,
          airlineIcao: airlineIcaoFromCallsign(pilot.callsign),
        };
      })
      .filter((flight) => flight.callsign)
      .sort((a, b) => a.callsign.localeCompare(b.callsign));

    return json({ airport, fetchedAt: new Date().toISOString(), flights });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, message.includes('IVAO_API_KEY') ? 503 : 502);
  }
}
