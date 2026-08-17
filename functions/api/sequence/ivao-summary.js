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

function flightPlanEobt(fp) {
  const candidates = [fp?.estimatedDepartureTime, fp?.eobt, fp?.offBlockTime, fp?.departureTime];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    return String(value);
  }
  return null;
}

async function getWhazzup(env) {
  if (!env.IVAO_API_KEY) throw new Error('IVAO_API_KEY is not configured');
  if (whazzupCache.data && Date.now() < whazzupCache.expiresAt) return whazzupCache.data;
  const response = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
    headers: { apiKey: env.IVAO_API_KEY, Accept: 'application/json' },
    cf: { cacheTtl: 15, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`IVAO tracker whazzup returned ${response.status}`);
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

    const inbound = pilots
      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport)
      .filter((pilot) => !terminalStates.has(String(pilot?.lastTrack?.state || '').trim().toLowerCase()))
      .map((pilot) => {
        const fp = pilot.flightPlan || {};
        const track = pilot.lastTrack || {};
        return {
          sessionId: String(pilot.id ?? ''),
          callsign: String(pilot.callsign || '').trim().toUpperCase(),
          aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,
          departure: fp.departureId ? String(fp.departureId).trim().toUpperCase() : null,
          arrival: airport,
          route: fp.route ? String(fp.route).trim().toUpperCase() : null,
          state: track.state ? String(track.state).trim() : null,
        };
      })
      .filter((flight) => flight.callsign)
      .sort((a, b) => a.callsign.localeCompare(b.callsign));

    const departures = pilots
      .filter((pilot) => String(pilot?.flightPlan?.departureId || '').trim().toUpperCase() === airport)
      .filter((pilot) => pilot?.lastTrack?.onGround !== false)
      .map((pilot) => {
        const fp = pilot.flightPlan || {};
        const track = pilot.lastTrack || {};
        return {
          sessionId: String(pilot.id ?? ''),
          callsign: String(pilot.callsign || '').trim().toUpperCase(),
          aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,
          arrival: fp.arrivalId ? String(fp.arrivalId).trim().toUpperCase() : null,
          route: fp.route ? String(fp.route).trim().toUpperCase() : null,
          state: track.state ? String(track.state).trim() : null,
          eobt: flightPlanEobt(fp),
        };
      })
      .filter((flight) => flight.callsign)
      .sort((a, b) => String(a.eobt || '9999').localeCompare(String(b.eobt || '9999')) || a.callsign.localeCompare(b.callsign));

    return json({ airport, fetchedAt: new Date().toISOString(), inbound, departures });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, message.includes('IVAO_API_KEY') ? 503 : 502);
  }
}
