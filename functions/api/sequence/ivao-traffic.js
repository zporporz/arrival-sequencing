const WHAZZUP_TTL_MS = 15000;
const FLIGHT_PLAN_TTL_MS = 5 * 60 * 1000;
const TAKEOFF_FOUND_TTL_MS = 6 * 60 * 60 * 1000;
const TAKEOFF_PENDING_TTL_MS = 30 * 1000;

let whazzupCache = { expiresAt: 0, data: null };
const flightPlanCache = new Map();
const takeoffCache = new Map();

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

function cleanCountryId(value) {
  const countryId = String(value || '').trim().toUpperCase();
  return countryId || null;
}

function airlineIcaoFromCallsign(value) {
  const callsign = String(value || '').trim().toUpperCase();
  const match = callsign.match(/^([A-Z]{3})[A-Z0-9]/);
  return match?.[1] || null;
}

function trimCache(cache, limit = 500) {
  while (cache.size > limit) {
    const firstKey = cache.keys().next().value;
    if (firstKey == null) return;
    cache.delete(firstKey);
  }
}

async function trackerJson(path, env, cacheTtl = 0) {
  if (!env.IVAO_API_KEY) throw new Error('IVAO_API_KEY is not configured');
  const response = await fetch(`https://api.ivao.aero${path}`, {
    headers: { apiKey: env.IVAO_API_KEY, Accept: 'application/json' },
    ...(cacheTtl > 0 ? { cf: { cacheTtl, cacheEverything: true } } : {}),
  });
  if (!response.ok) throw new Error(`IVAO tracker ${path} returned ${response.status}`);
  return response.json();
}

async function getWhazzup(env) {
  if (whazzupCache.data && Date.now() < whazzupCache.expiresAt) return whazzupCache.data;
  const data = await trackerJson('/v2/tracker/whazzup', env, 15);
  whazzupCache = { expiresAt: Date.now() + WHAZZUP_TTL_MS, data };
  return data;
}

async function getLatestFlightPlan(sessionId, env) {
  const key = String(sessionId);
  const cached = flightPlanCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await trackerJson(`/v2/tracker/sessions/${encodeURIComponent(key)}/flightPlans/latest`, env, 60);
  flightPlanCache.set(key, { expiresAt: Date.now() + FLIGHT_PLAN_TTL_MS, value });
  trimCache(flightPlanCache);
  return value;
}

function findTrackedTakeoff(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const ordered = [...tracks].sort((left, right) => {
    const leftTime = new Date(left?.timestamp || 0).getTime();
    const rightTime = new Date(right?.timestamp || 0).getTime();
    return leftTime - rightTime;
  });

  let sawGround = false;
  for (const track of ordered) {
    if (track?.onGround === true) {
      sawGround = true;
      continue;
    }
    if (!sawGround || track?.onGround !== false) continue;
    const timestamp = new Date(track.timestamp || '').getTime();
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return null;
}

async function getTrackedTakeoff(sessionId, env) {
  const key = String(sessionId);
  const cached = takeoffCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const tracks = await trackerJson(`/v2/tracker/sessions/${encodeURIComponent(key)}/tracks`, env, 15);
  const value = findTrackedTakeoff(tracks);
  takeoffCache.set(key, {
    expiresAt: Date.now() + (value ? TAKEOFF_FOUND_TTL_MS : TAKEOFF_PENDING_TTL_MS),
    value,
  });
  trimCache(takeoffCache);
  return value;
}

async function domesticContext(pilot, env) {
  const summary = pilot?.flightPlan || {};
  let departureCountryId = cleanCountryId(summary?.departure?.countryId);
  let arrivalCountryId = cleanCountryId(summary?.arrival?.countryId);
  let filedEetSeconds = null;
  let detailedFlightPlan = null;
  let enrichmentError = null;

  const countryUnknown = !departureCountryId || !arrivalCountryId;
  const summaryLooksDomestic = departureCountryId === 'TH' && arrivalCountryId === 'TH';

  if (countryUnknown || summaryLooksDomestic) {
    try {
      detailedFlightPlan = await getLatestFlightPlan(pilot.id, env);
      departureCountryId = cleanCountryId(detailedFlightPlan?.departure?.countryId) || departureCountryId;
      arrivalCountryId = cleanCountryId(detailedFlightPlan?.arrival?.countryId) || arrivalCountryId;
      filedEetSeconds = finiteNumber(detailedFlightPlan?.eet);
    } catch (error) {
      enrichmentError = error instanceof Error ? error.message : String(error);
    }
  }

  const isDomesticThailand = departureCountryId === 'TH' && arrivalCountryId === 'TH';
  if (!isDomesticThailand) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: false,
      filedEetSeconds: null,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'NOT_DOMESTIC',
      domesticTriggerError: enrichmentError,
      detailedFlightPlan,
    };
  }

  if (filedEetSeconds == null || filedEetSeconds <= 0) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      filedEetSeconds,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'EET_UNAVAILABLE',
      domesticTriggerError: enrichmentError,
      detailedFlightPlan,
    };
  }

  const state = String(pilot?.lastTrack?.state || '').trim().toLowerCase();
  const airborneNow = pilot?.lastTrack?.onGround === false || ['initial climb', 'en route', 'approach'].includes(state);
  if (!airborneNow) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      filedEetSeconds,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'WAITING_TAKEOFF',
      domesticTriggerError: enrichmentError,
      detailedFlightPlan,
    };
  }

  let trackedTakeoffAt = null;
  try {
    trackedTakeoffAt = await getTrackedTakeoff(pilot.id, env);
  } catch (error) {
    enrichmentError = error instanceof Error ? error.message : String(error);
  }

  if (!trackedTakeoffAt) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      filedEetSeconds,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'TAKEOFF_UNAVAILABLE',
      domesticTriggerError: enrichmentError,
      detailedFlightPlan,
    };
  }

  const takeoffMs = new Date(trackedTakeoffAt).getTime();
  const filedDestinationEtaAt = Number.isFinite(takeoffMs)
    ? new Date(takeoffMs + filedEetSeconds * 1000).toISOString()
    : null;

  return {
    departureCountryId,
    arrivalCountryId,
    isDomesticThailand: true,
    filedEetSeconds,
    trackedTakeoffAt,
    filedDestinationEtaAt,
    domesticTriggerStatus: filedDestinationEtaAt ? 'READY' : 'TAKEOFF_UNAVAILABLE',
    domesticTriggerError: enrichmentError,
    detailedFlightPlan,
  };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const airport = cleanAirport(url.searchParams.get('airport'));
    if (!airport) return json({ error: 'Valid airport ICAO is required' }, 400);

    const data = await getWhazzup(context.env);
    const pilots = Array.isArray(data?.clients?.pilots) ? data.clients.pilots : [];
    const terminalStates = new Set(['landed', 'on blocks']);

    const inboundPilots = pilots
      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport)
      .filter((pilot) => !terminalStates.has(String(pilot?.lastTrack?.state || '').trim().toLowerCase()));

    const flights = await Promise.all(inboundPilots.map(async (pilot) => {
      const fp = pilot.flightPlan || {};
      const track = pilot.lastTrack || {};
      let domestic = {
        departureCountryId: cleanCountryId(fp?.departure?.countryId),
        arrivalCountryId: cleanCountryId(fp?.arrival?.countryId),
        isDomesticThailand: false,
        filedEetSeconds: null,
        trackedTakeoffAt: null,
        filedDestinationEtaAt: null,
        domesticTriggerStatus: 'UNKNOWN',
        detailedFlightPlan: null,
      };

      try {
        domestic = await domesticContext(pilot, context.env);
      } catch {
        // Domestic enrichment is optional. Keep the live traffic row usable if IVAO detail endpoints fail.
      }

      const detailed = domestic.detailedFlightPlan || {};
      return {
        sessionId: String(pilot.id ?? ''),
        vid: pilot.userId != null ? String(pilot.userId) : null,
        callsign: String(pilot.callsign || '').trim().toUpperCase(),
        aircraft: fp.aircraftId ? String(fp.aircraftId).trim().toUpperCase() : null,
        departure: fp.departureId ? String(fp.departureId).trim().toUpperCase() : null,
        arrival: airport,
        route: fp.route ? String(fp.route).trim().toUpperCase() : (detailed.route ? String(detailed.route).trim().toUpperCase() : null),
        state: track.state ? String(track.state).trim() : null,
        altitude: finiteNumber(track.altitude, pilot.altitude),
        groundSpeed: finiteNumber(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
        latitude: finiteNumber(track.latitude, track.lat, pilot.latitude, pilot.lat),
        longitude: finiteNumber(track.longitude, track.lon, track.lng, pilot.longitude, pilot.lon, pilot.lng),
        heading: finiteNumber(track.heading, track.course, pilot.heading),
        connectedAt: pilot.createdAt || null,
        airlineIcao: airlineIcaoFromCallsign(pilot.callsign),
        departureCountryId: domestic.departureCountryId,
        arrivalCountryId: domestic.arrivalCountryId,
        isDomesticThailand: domestic.isDomesticThailand,
        filedEetSeconds: domestic.filedEetSeconds,
        trackedTakeoffAt: domestic.trackedTakeoffAt,
        filedDestinationEtaAt: domestic.filedDestinationEtaAt,
        domesticTriggerStatus: domestic.domesticTriggerStatus,
      };
    }));

    return json({
      airport,
      fetchedAt: new Date().toISOString(),
      flights: flights.filter((flight) => flight.callsign).sort((a, b) => a.callsign.localeCompare(b.callsign)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, message.includes('IVAO_API_KEY') ? 503 : 502);
  }
}
