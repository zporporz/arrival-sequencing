import { looksLandedAtAirport, reconcileAmanFlights } from '../../_lib/amanSharedState.js';

const WHAZZUP_TTL_MS = 15000;
const FLIGHT_PLAN_TTL_MS = 5 * 60 * 1000;
const TAKEOFF_FOUND_TTL_MS = 6 * 60 * 60 * 1000;
const TAKEOFF_PENDING_TTL_MS = 30 * 1000;
const FLIGHT_PLAN_ENRICH_CONCURRENCY = 8;

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

function cleanUpper(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || null;
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function filedCruiseAltitudeFt(detailed, summary) {
  const direct = finiteNumber(
    detailed?.cruiseLevel,
    detailed?.cruiseAltitude,
    detailed?.altitude,
    detailed?.level,
    summary?.cruiseLevel,
    summary?.cruiseAltitude,
    summary?.altitude,
    summary?.level,
  );
  if (direct == null || direct <= 0) return null;

  // Tracker payloads may expose either feet (e.g. 35000) or a flight level (e.g. 350).
  return direct < 1000 ? direct * 100 : direct;
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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

async function getLatestFlightPlan(sessionId, env, airborne = false) {
  const key = String(sessionId);
  const cached = flightPlanCache.get(key);
  const cachedActualDeparture = finiteNumber(cached?.value?.actualDepartureTime);
  // A pre-takeoff flight-plan response may not yet contain Actual Departure.
  // Once Whazzup says airborne, refresh that incomplete record every 30 seconds
  // instead of hiding IVAO's update behind the normal five-minute cache.
  if (cached && cached.expiresAt > Date.now() && (!airborne || cachedActualDeparture != null)) return cached.value;

  const value = await trackerJson(
    `/v2/tracker/sessions/${encodeURIComponent(key)}/flightPlans/latest`,
    env,
    airborne ? 0 : 60,
  );
  const actualDeparture = finiteNumber(value?.actualDepartureTime);
  const ttl = airborne && actualDeparture == null ? TAKEOFF_PENDING_TTL_MS : FLIGHT_PLAN_TTL_MS;
  flightPlanCache.set(key, { expiresAt: Date.now() + ttl, value });
  trimCache(flightPlanCache);
  return value;
}

export function findTrackedTakeoffEvidence(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) {
    return { trackedTakeoffAt: null, connectedAirborne: false };
  }
  const ordered = [...tracks].sort((left, right) => {
    const leftTime = new Date(left?.timestamp || 0).getTime();
    const rightTime = new Date(right?.timestamp || 0).getTime();
    return leftTime - rightTime;
  });

  const firstTrackedState = ordered.find((track) => typeof track?.onGround === 'boolean');
  const connectedAirborne = firstTrackedState?.onGround === false;
  let sawGround = false;
  for (const track of ordered) {
    if (track?.onGround === true) {
      sawGround = true;
      continue;
    }
    if (!sawGround || track?.onGround !== false) continue;
    const timestamp = new Date(track.timestamp || '').getTime();
    if (Number.isFinite(timestamp)) {
      return { trackedTakeoffAt: new Date(timestamp).toISOString(), connectedAirborne: false };
    }
  }
  return { trackedTakeoffAt: null, connectedAirborne };
}

async function getTrackedTakeoffEvidence(sessionId, env) {
  const key = String(sessionId);
  const cached = takeoffCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const tracks = await trackerJson(`/v2/tracker/sessions/${encodeURIComponent(key)}/tracks`, env, 15);
  const value = findTrackedTakeoffEvidence(tracks);
  takeoffCache.set(key, {
    expiresAt: Date.now() + (value.trackedTakeoffAt || value.connectedAirborne ? TAKEOFF_FOUND_TTL_MS : TAKEOFF_PENDING_TTL_MS),
    value,
  });
  trimCache(takeoffCache);
  return value;
}

async function getTrackedTakeoff(sessionId, env) {
  return (await getTrackedTakeoffEvidence(sessionId, env)).trackedTakeoffAt;
}

function isAirborneNow(pilot) {
  const state = String(pilot?.lastTrack?.state || '').trim().toLowerCase();
  return pilot?.lastTrack?.onGround === false || ['initial climb', 'en route', 'approach'].includes(state);
}

function pilotTrackSnapshot(pilot) {
  const track = pilot?.lastTrack || {};
  return {
    state: track.state,
    onGround: track.onGround,
    latitude: finiteNumber(track.latitude, track.lat, pilot.latitude, pilot.lat),
    longitude: finiteNumber(track.longitude, track.lon, track.lng, pilot.longitude, pilot.lon, pilot.lng),
    groundSpeed: finiteNumber(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
  };
}

export async function isLocalPredeparturePilot(pilot, airportValue, env) {
  const airport = cleanAirport(airportValue);
  if (!airport) return false;
  const flightPlan = pilot?.flightPlan || {};
  const departure = String(flightPlan.departureId || '').trim().toUpperCase();
  const arrival = String(flightPlan.arrivalId || '').trim().toUpperCase();
  if (departure !== airport || arrival !== airport) return false;
  if (!looksLandedAtAirport(pilotTrackSnapshot(pilot), airport)) return false;

  // For a same-airport flight, position alone cannot tell whether the aircraft is
  // waiting to depart or has returned after landing. An actual departure time or
  // a ground-to-air transition in this IVAO session proves it has already flown.
  const actualDeparture = finiteNumber(flightPlan.actualDepartureTime);
  if (actualDeparture != null && actualDeparture > 0) return false;

  const sessionId = String(pilot?.id ?? '').trim();
  if (!sessionId) return true;

  try {
    return !(await getTrackedTakeoff(sessionId, env));
  } catch {
    // If IVAO track history is temporarily unavailable, keep the flight visible.
    // Losing a legitimate inbound is operationally worse than retaining one
    // ambiguous local flight for another refresh cycle.
    return true;
  }
}

async function legacyDomesticTiming(pilot, detailedFlightPlan, env) {
  const summary = pilot?.flightPlan || {};
  const detailed = detailedFlightPlan || {};
  const departureCountryId = cleanCountryId(detailed?.departure?.countryId) || cleanCountryId(summary?.departure?.countryId);
  const arrivalCountryId = cleanCountryId(detailed?.arrival?.countryId) || cleanCountryId(summary?.arrival?.countryId);
  const filedEetSeconds = finiteNumber(detailed?.eet, summary?.eet);
  const isDomesticThailand = departureCountryId === 'TH' && arrivalCountryId === 'TH';

  if (!isDomesticThailand) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: false,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'NOT_DOMESTIC',
      domesticTriggerError: null,
    };
  }

  if (filedEetSeconds == null || filedEetSeconds <= 0) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'EET_UNAVAILABLE',
      domesticTriggerError: null,
    };
  }

  if (!isAirborneNow(pilot)) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'WAITING_TAKEOFF',
      domesticTriggerError: null,
    };
  }

  let trackedTakeoffAt = null;
  let domesticTriggerError = null;
  try {
    trackedTakeoffAt = await getTrackedTakeoff(pilot.id, env);
  } catch (error) {
    domesticTriggerError = error instanceof Error ? error.message : String(error);
  }

  if (!trackedTakeoffAt) {
    return {
      departureCountryId,
      arrivalCountryId,
      isDomesticThailand: true,
      trackedTakeoffAt: null,
      filedDestinationEtaAt: null,
      domesticTriggerStatus: 'TAKEOFF_UNAVAILABLE',
      domesticTriggerError,
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
    trackedTakeoffAt,
    filedDestinationEtaAt,
    domesticTriggerStatus: filedDestinationEtaAt ? 'READY' : 'TAKEOFF_UNAVAILABLE',
    domesticTriggerError,
  };
}

async function airborneSessionEvidence(pilot, detailedFlightPlan, env) {
  if (!isAirborneNow(pilot)) return { trackedTakeoffAt: null, connectedAirborne: false, error: null };
  if (finiteNumber(detailedFlightPlan?.actualDepartureTime, pilot?.flightPlan?.actualDepartureTime) != null) {
    return { trackedTakeoffAt: null, connectedAirborne: false, error: null };
  }

  const sessionId = String(pilot?.id ?? '').trim();
  if (!sessionId) return { trackedTakeoffAt: null, connectedAirborne: false, error: null };
  try {
    const evidence = await getTrackedTakeoffEvidence(sessionId, env);
    return { ...evidence, error: null };
  } catch (error) {
    return {
      trackedTakeoffAt: null,
      connectedAirborne: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const airport = cleanAirport(url.searchParams.get('airport'));
    if (!airport) return json({ error: 'Valid airport ICAO is required' }, 400);

    const data = await getWhazzup(context.env);
    const pilots = Array.isArray(data?.clients?.pilots) ? data.clients.pilots : [];
    // Pass terminal arrivals through reconciliation as well. It needs the current
    // destination-ground snapshot to expire the old active/ghost record cleanly.
    const inboundPilots = pilots
      .filter((pilot) => String(pilot?.flightPlan?.arrivalId || '').trim().toUpperCase() === airport);

    const flights = await mapWithConcurrency(
      inboundPilots,
      FLIGHT_PLAN_ENRICH_CONCURRENCY,
      async (pilot) => {
        const fp = pilot.flightPlan || {};
        const track = pilot.lastTrack || {};
        const predepartureLocal = await isLocalPredeparturePilot(pilot, airport, context.env);
        let detailed = {};
        let flightPlanDetailError = null;

        try {
          detailed = await getLatestFlightPlan(pilot.id, context.env, isAirborneNow(pilot)) || {};
        } catch (error) {
          flightPlanDetailError = error instanceof Error ? error.message : String(error);
        }

        const domestic = await legacyDomesticTiming(pilot, detailed, context.env);
        const sessionEvidence = await airborneSessionEvidence(pilot, detailed, context.env);
        const aircraftSummary = detailed?.aircraft || fp?.aircraft || {};
        const filedEetSeconds = finiteNumber(detailed?.eet, fp?.eet);
        const flightRules = cleanUpper(detailed?.rules) || cleanUpper(fp?.rules);

        return {
          sessionId: String(pilot.id ?? ''),
          vid: pilot.userId != null ? String(pilot.userId) : null,
          callsign: String(pilot.callsign || '').trim().toUpperCase(),
          aircraft: cleanUpper(detailed?.aircraftId) || cleanUpper(fp?.aircraftId) || cleanUpper(aircraftSummary?.icaoCode),
          wakeTurbulence: cleanUpper(aircraftSummary?.wakeTurbulence),
          departure: cleanUpper(detailed?.departureId) || cleanUpper(fp?.departureId),
          arrival: airport,
          route: cleanUpper(detailed?.route) || cleanUpper(fp?.route),
          flightRules,
          state: track.state ? String(track.state).trim() : null,
          onGround: typeof track.onGround === 'boolean' ? track.onGround : null,
          trackTimestamp: track.timestamp || null,
          altitude: finiteNumber(track.altitude, pilot.altitude),
          verticalSpeedFpm: finiteNumber(track.verticalSpeed, track.verticalSpeedFpm, track.vertical_rate, track.verticalRate, pilot.verticalSpeed),
          groundSpeed: finiteNumber(track.groundSpeed, track.groundspeed, track.speed, pilot.groundSpeed),
          latitude: finiteNumber(track.latitude, track.lat, pilot.latitude, pilot.lat),
          longitude: finiteNumber(track.longitude, track.lon, track.lng, pilot.longitude, pilot.lon, pilot.lng),
          heading: finiteNumber(track.heading, track.course, pilot.heading),
          connectedAt: pilot.createdAt || null,
          airlineIcao: airlineIcaoFromCallsign(pilot.callsign),
          flightPlanId: detailed?.id != null ? String(detailed.id) : null,
          flightPlanRevision: finiteNumber(detailed?.revision),
          filedCruiseAltitudeFt: filedCruiseAltitudeFt(detailed, fp),
          filedDepartureTimeSeconds: finiteNumber(detailed?.departureTime, fp?.departureTime),
          actualDepartureTimeSeconds: finiteNumber(detailed?.actualDepartureTime, fp?.actualDepartureTime),
          filedEetSeconds,
          departureCountryId: domestic.departureCountryId,
          arrivalCountryId: domestic.arrivalCountryId,
          isDomesticThailand: domestic.isDomesticThailand,
          trackedTakeoffAt: domestic.trackedTakeoffAt || sessionEvidence.trackedTakeoffAt,
          connectedAirborne: sessionEvidence.connectedAirborne,
          filedDestinationEtaAt: domestic.filedDestinationEtaAt,
          domesticTriggerStatus: domestic.domesticTriggerStatus,
          domesticTriggerError: domestic.domesticTriggerError || sessionEvidence.error,
          flightPlanDetailError,
          predepartureLocal,
        };
      },
    );

    const fetchedAt = new Date().toISOString();
    const liveFlights = flights
      .filter((flight) => flight.callsign)
      .filter((flight) => !['V', 'VFR'].includes(flight.flightRules || ''))
      .sort((a, b) => a.callsign.localeCompare(b.callsign));

    let sharedStateError = null;
    let reconciledFlights = liveFlights.filter((flight) => (
      flight.predepartureLocal || !looksLandedAtAirport(flight, airport)
    ));
    try {
      reconciledFlights = await reconcileAmanFlights(context.env, airport, liveFlights, fetchedAt);
    } catch (error) {
      sharedStateError = error instanceof Error ? error.message : String(error);
    }

    return json({
      airport,
      fetchedAt,
      flights: reconciledFlights,
      sharedStateError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, message.includes('IVAO_API_KEY') ? 503 : 502);
  }
}
