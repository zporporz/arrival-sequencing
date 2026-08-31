import { supabaseAdminRequest } from './supabaseAdmin.js';

export const AMAN_GHOST_RETENTION_MS = 30 * 60 * 1000;
export const AMAN_RECONNECT_NOTICE_MS = 5 * 60 * 1000;

const TERMINAL_STATES = new Set([
  'landed',
  'on blocks',
  'on ground',
  'taxi',
  'taxiing',
  'parking',
]);

const AIRPORT_REFERENCE = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.6811, lon: 100.7473 },
};

const RUNWAY_FINAL_GEOMETRY = {
  'VTBD:21R': { lat: 13 + 55 / 60 + 34.87 / 3600, lon: 100 + 36 / 60 + 44.62 / 3600, course: 209 },
  'VTBD:21L': { lat: 13 + 55 / 60 + 28.33 / 3600, lon: 100 + 36 / 60 + 55.97 / 3600, course: 208 },
  'VTBS:19': { lat: 13 + 41 / 60 + 30.17 / 3600, lon: 100 + 45 / 60 + 39.72 / 3600, course: 194.42 },
  'VTBS:20L': { lat: 13 + 42 / 60 + 13.21 / 3600, lon: 100 + 44 / 60 + 35.44 / 3600, course: 194.42 },
  'VTBS:20R': { lat: 13 + 42 / 60 + 0.68 / 3600, lon: 100 + 44 / 60 + 18.41 / 3600, course: 194 },
};

// If a pilot disconnects immediately after touchdown, IVAO can disappear before
// the next Whazzup sample explicitly says LANDED/ON GROUND. In that case only
// release the slot when the last position is very close to the airport and the
// last groundspeed is already taxi/rollout-like. A short-final aircraft is still
// fast enough that it will remain protected as a GHOST rather than being dropped.
const LANDED_RELEASE_RADIUS_NM = 3.5;
const LANDED_RELEASE_MAX_GS_KT = 90;
const MISSED_REINSERT_RECENCY_MS = 2 * 60 * 1000;
const GA_ARM_MAX_AGE_MS = 12 * 60 * 1000;
const GA_ACTIVE_MAX_AGE_MS = 45 * 60 * 1000;
const GA_DIRECT_INSERT_OFFSET_MS = 10 * 60 * 1000;
const GA_TRACK_MAX_AGE_MS = 90 * 1000;
const GA_MAX_AIRPORT_DISTANCE_NM = 15;
const GA_MIN_CLIMB_FPM = 300;
const GA_MIN_ALTITUDE_GAIN_FT = 80;
const GA_REENTRY_MIN_AGE_MS = 60 * 1000;
const GA_TERMINAL_GRACE_MS = 2 * 60 * 1000;
const FINAL_ALONG_NM = 10;
const FINAL_CROSS_NM = 1.5;
const FINAL_HEADING_TOLERANCE_DEG = 35;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanAirport(value) {
  const airport = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(airport) ? airport : null;
}

function cleanCallsign(value) {
  const callsign = String(value ?? '').trim().toUpperCase();
  return callsign ? callsign.slice(0, 20) : null;
}

function toMillis(value, fallback = NaN) {
  const millis = new Date(value ?? '').getTime();
  return Number.isFinite(millis) ? millis : fallback;
}

function toIso(value) {
  const millis = toMillis(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export function utcServiceDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function toDegrees(value) {
  return value * 180 / Math.PI;
}

function angularDifference(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const earthRadiusNm = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initialBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const lambda = toRadians(lon2 - lon1);
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function evaluateFinalObservation(airport, flight) {
  if (flight?.onGround !== false) return null;
  const latitude = finite(flight?.latitude);
  const longitude = finite(flight?.longitude);
  const heading = finite(flight?.heading);
  if (latitude == null || longitude == null || heading == null) return null;

  let best = null;
  for (const [key, geometry] of Object.entries(RUNWAY_FINAL_GEOMETRY)) {
    const [geometryAirport, runway] = key.split(':');
    if (geometryAirport !== airport) continue;
    const direct = distanceNm(latitude, longitude, geometry.lat, geometry.lon);
    const courseDelta = angularDifference(initialBearing(latitude, longitude, geometry.lat, geometry.lon), geometry.course);
    const alongNm = direct * Math.cos(toRadians(courseDelta));
    const crossNm = Math.abs(direct * Math.sin(toRadians(courseDelta)));
    const headingDelta = Math.abs(angularDifference(heading, geometry.course));
    if (alongNm < 0 || alongNm > FINAL_ALONG_NM || crossNm > FINAL_CROSS_NM || headingDelta > FINAL_HEADING_TOLERANCE_DEG) continue;
    const candidate = { runway, alongNm, crossNm, headingDelta };
    if (!best || candidate.crossNm < best.crossNm || (candidate.crossNm === best.crossNm && candidate.alongNm < best.alongNm)) {
      best = candidate;
    }
  }
  return best;
}

function activeMissedApproach(record, nowMs) {
  if (record?.missed_approach_active !== true) return false;
  const detectedMs = toMillis(record?.missed_approach_detected_at, 0);
  const expiresMs = toMillis(record?.missed_approach_expires_at, detectedMs + GA_ACTIVE_MAX_AGE_MS);
  return detectedMs > 0 && nowMs <= expiresMs;
}

export function detectAutomaticMissedApproach(record, current, airport, nowMs) {
  if (!record || activeMissedApproach(record, nowMs)) return null;
  // The normal path is armed by a live 10 NM final observation.  A controller
  // can also open the page after the aircraft has already started the missed
  // approach; in that case a recent centrally persisted FROZEN capture is the
  // proof that this was an arrival, not an ordinary departure.
  const armedMs = toMillis(
    record.ga_armed_at || record.frozen_captured_at || record.frozen_track_at,
    0,
  );
  if (armedMs <= 0 || nowMs - armedMs < 0 || nowMs - armedMs > GA_ARM_MAX_AGE_MS) return null;
  const runway = cleanText(record.ga_armed_runway || record.frozen_runway, 12)?.toUpperCase();
  if (!runway || !RUNWAY_FINAL_GEOMETRY[`${airport}:${runway}`] || current?.onGround !== false) return null;

  const trackMs = snapshotTimeMs(current, NaN);
  if (!Number.isFinite(trackMs) || Math.abs(nowMs - trackMs) > GA_TRACK_MAX_AGE_MS) return null;
  const latitude = finite(current?.latitude);
  const longitude = finite(current?.longitude);
  const reference = AIRPORT_REFERENCE[airport];
  if (latitude == null || longitude == null || !reference
    || distanceNm(reference.lat, reference.lon, latitude, longitude) > GA_MAX_AIRPORT_DISTANCE_NM) return null;

  const state = String(current?.state || '').trim().toLowerCase();
  const verticalSpeedFpm = finite(current?.verticalSpeedFpm);
  const currentAltitude = finite(current?.altitude);
  const armedAltitude = finite(record.ga_armed_altitude_ft);
  const previousAltitude = finite(record?.snapshot?.altitude);
  const altitudeReference = previousAltitude ?? armedAltitude;
  const altitudeGain = currentAltitude != null && altitudeReference != null
    ? currentAltitude - altitudeReference
    : null;
  const explicitClimb = state === 'initial climb' || state === 'departing';
  const observedClimb = verticalSpeedFpm != null
    && verticalSpeedFpm >= GA_MIN_CLIMB_FPM
    && (altitudeGain == null || altitudeGain >= GA_MIN_ALTITUDE_GAIN_FT);
  if (!explicitClimb && !observedClimb) return null;

  return {
    runway,
    detectedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + GA_ACTIVE_MAX_AGE_MS).toISOString(),
    targetTldt: new Date(nowMs + GA_DIRECT_INSERT_OFFSET_MS).toISOString(),
  };
}

function snapshotTimeMs(flight, fallback) {
  return toMillis(flight?.trackTimestamp, fallback);
}

function reconnectPlausibility(previous, current, fallbackDtMs) {
  const previousLat = finite(previous?.latitude);
  const previousLon = finite(previous?.longitude);
  const currentLat = finite(current?.latitude);
  const currentLon = finite(current?.longitude);
  if ([previousLat, previousLon, currentLat, currentLon].some((value) => value == null)) {
    return { jumpNm: null, expectedNm: null, plausible: true };
  }

  const previousTime = snapshotTimeMs(previous, Date.now() - fallbackDtMs);
  const currentTime = snapshotTimeMs(current, Date.now());
  const dtMs = Math.max(1000, currentTime > previousTime ? currentTime - previousTime : fallbackDtMs);
  const dtHours = dtMs / 3600000;
  const jumpNm = distanceNm(previousLat, previousLon, currentLat, currentLon);
  const speeds = [finite(previous?.groundSpeed), finite(current?.groundSpeed)]
    .filter((value) => value != null && value > 30);
  const referenceSpeed = speeds.length
    ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length
    : 450;
  const expectedNm = referenceSpeed * dtHours;
  const maxPlausibleNm = Math.max(15, expectedNm * 1.8 + 10);
  return { jumpNm, expectedNm, plausible: jumpNm <= maxPlausibleNm };
}

function hardIdentityConflict(record, flight) {
  const previousVid = cleanText(record?.vid, 32);
  const currentVid = cleanText(flight?.vid, 32);
  if (previousVid && currentVid && previousVid !== currentVid) return true;

  const previousDeparture = cleanText(record?.departure, 8)?.toUpperCase();
  const currentDeparture = cleanText(flight?.departure, 8)?.toUpperCase();
  if (previousDeparture && currentDeparture && previousDeparture !== currentDeparture) return true;

  const previousArrival = cleanText(record?.arrival, 8)?.toUpperCase();
  const currentArrival = cleanText(flight?.arrival, 8)?.toUpperCase();
  if (previousArrival && currentArrival && previousArrival !== currentArrival) return true;

  return false;
}

function isTerminalSnapshot(snapshot) {
  const state = String(snapshot?.state ?? '').trim().toLowerCase();
  return snapshot?.onGround === true || TERMINAL_STATES.has(state);
}

export function looksLandedAtAirport(snapshot, airport) {
  const reference = AIRPORT_REFERENCE[airport];
  if (!reference) return false;

  const latitude = finite(snapshot?.latitude);
  const longitude = finite(snapshot?.longitude);
  const groundSpeed = finite(snapshot?.groundSpeed);
  if (latitude == null || longitude == null) {
    // A bare LANDED state is still useful when IVAO omits position, but ON BLOCKS /
    // ON GROUND can also describe an aircraft waiting at its departure gate.
    return String(snapshot?.state ?? '').trim().toLowerCase() === 'landed';
  }

  const airportDistanceNm = distanceNm(reference.lat, reference.lon, latitude, longitude);
  if (airportDistanceNm > LANDED_RELEASE_RADIUS_NM) return false;
  return isTerminalSnapshot(snapshot)
    || (groundSpeed != null && groundSpeed <= LANDED_RELEASE_MAX_GS_KT);
}

// A controller-triggered GA/MISSED direct insert writes a fresh MANUAL target at
// NOW+10 while IVAO can still report the aircraft as LANDED for several samples.
// Preserve that one case in the active sequence. The manual update must be recent
// relative to the terminal observation so an ordinary pre-landing manual target
// does not accidentally keep a genuinely landed aircraft in AMAN.
function hasActiveMissedReinsert(record, snapshot, nowMs) {
  if (String(record?.operational_state || 'NORMAL').trim().toUpperCase() !== 'NORMAL') return false;
  if (String(record?.target_mode || 'AUTO').trim().toUpperCase() !== 'MANUAL') return false;

  if (activeMissedApproach(record, nowMs)) return true;

  const targetMs = toMillis(record?.manual_tldt);
  if (!Number.isFinite(targetMs) || targetMs <= nowMs) return false;

  const updatedMs = toMillis(record?.manual_updated_at, 0);
  const observedMs = snapshotTimeMs(snapshot, nowMs);
  return updatedMs > 0 && updatedMs >= observedMs - MISSED_REINSERT_RECENCY_MS;
}

function sharedFields(record) {
  return {
    connectionPhase: record?.connection_phase || 'LIVE',
    disconnectedAt: record?.disconnected_at || null,
    reconnectAt: record?.reconnect_at || null,
    jumpNm: record?.jump_nm == null ? null : Number(record.jump_nm),
    expectedNm: record?.expected_nm == null ? null : Number(record.expected_nm),
    targetMode: record?.target_mode || 'AUTO',
    manualTldt: record?.manual_tldt || null,
    manualRunway: record?.manual_runway || null,
    manualUpdatedByVid: record?.manual_updated_by_vid || null,
    manualUpdatedByName: record?.manual_updated_by_name || null,
    manualUpdatedAt: record?.manual_updated_at || null,
    autoBaselineTldt: record?.auto_baseline_tldt || null,
    autoBaselineRunway: record?.auto_baseline_runway || null,
    autoBaselineRank: record?.auto_baseline_rank == null ? null : Number(record.auto_baseline_rank),
    autoBaselineCapturedAt: record?.auto_baseline_captured_at || null,
    autoReturnTldt: record?.auto_return_tldt || null,
    autoReturnFloorTldt: record?.auto_return_floor_tldt || null,
    autoReturnRunway: record?.auto_return_runway || null,
    autoReturnedAt: record?.auto_returned_at || null,
    holdingMode: record?.holding_mode || 'AUTO',
    holdingFix: record?.holding_fix || null,
    holdingLeaveAt: record?.holding_leave_at || null,
    missedApproachActive: record?.missed_approach_active === true,
    missedApproachSource: record?.missed_approach_source || null,
    missedApproachDetectedAt: record?.missed_approach_detected_at || null,
    missedApproachExpiresAt: record?.missed_approach_expires_at || null,
  };
}

const EMPTY_GA_STATE = Object.freeze({
  ga_armed_at: null,
  ga_armed_runway: null,
  ga_armed_altitude_ft: null,
  ga_armed_track_at: null,
  missed_approach_active: false,
  missed_approach_source: null,
  missed_approach_detected_at: null,
  missed_approach_expires_at: null,
});

function gaStatePatch(record, snapshot, airport, nowMs, terminalNow) {
  const finalObservation = evaluateFinalObservation(airport, snapshot);
  const automatic = detectAutomaticMissedApproach(record, snapshot, airport, nowMs);
  if (automatic) {
    return {
      ...EMPTY_GA_STATE,
      missed_approach_active: true,
      missed_approach_source: 'AUTO',
      missed_approach_detected_at: automatic.detectedAt,
      missed_approach_expires_at: automatic.expiresAt,
      operational_state: 'NORMAL',
      operational_updated_by_vid: null,
      operational_updated_by_name: 'AMAN AUTO GA',
      operational_updated_at: automatic.detectedAt,
      target_mode: 'MANUAL',
      manual_tldt: automatic.targetTldt,
      manual_runway: automatic.runway,
      manual_updated_by_vid: null,
      manual_updated_by_name: 'AMAN AUTO GA',
      manual_updated_at: automatic.detectedAt,
      frozen_tldt: null,
      frozen_runway: null,
      frozen_approach_category: null,
      frozen_distance_nm: null,
      frozen_reference_speed_kt: null,
      frozen_track_at: null,
      frozen_captured_at: null,
      frozen_captured_by_vid: null,
      frozen_captured_by_name: null,
    };
  }

  const active = activeMissedApproach(record, nowMs);
  const detectedMs = toMillis(record?.missed_approach_detected_at, 0);
  const currentState = String(snapshot?.state || '').trim().toLowerCase();
  const currentVerticalSpeed = finite(snapshot?.verticalSpeedFpm);
  const stillClimbingOut = currentState === 'initial climb'
    || currentState === 'departing'
    || (currentVerticalSpeed != null && currentVerticalSpeed >= GA_MIN_CLIMB_FPM);
  const reenteredFinal = active
    && finalObservation
    && !stillClimbingOut
    && nowMs - detectedMs >= GA_REENTRY_MIN_AGE_MS;
  const completedLanding = active && terminalNow && nowMs - detectedMs >= GA_TERMINAL_GRACE_MS;
  const expired = record?.missed_approach_active === true && !active;
  const patch = !record ? { ...EMPTY_GA_STATE } : {};

  if (reenteredFinal || completedLanding || expired) {
    Object.assign(patch, {
      missed_approach_active: false,
      missed_approach_expires_at: null,
    });
  }

  if (finalObservation && (!active || reenteredFinal)) {
    Object.assign(patch, {
      ga_armed_at: new Date(nowMs).toISOString(),
      ga_armed_runway: finalObservation.runway,
      ga_armed_altitude_ft: finite(snapshot?.altitude),
      ga_armed_track_at: toIso(snapshot?.trackTimestamp) || new Date(nowMs).toISOString(),
    });
  }

  return patch;
}

async function loadFlightStates(env, serviceDate, airport) {
  const result = await supabaseAdminRequest(
    env,
    `aman_flight_states?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&airport=eq.${encodeURIComponent(airport)}`,
  );
  return Array.isArray(result.data) ? result.data : [];
}

async function writeFlightStates(env, rows) {
  if (!rows.length) return [];
  // PostgREST bulk inserts require every object in one JSON array to expose the
  // same columns. A reconciliation contains full live rows as well as partial
  // GHOST/EXPIRED patches, so submit one batch per exact column shape. This
  // preserves merge semantics without filling omitted fields with null.
  const groups = new Map();
  for (const row of rows) {
    const signature = Object.keys(row).sort().join('\u001f');
    const group = groups.get(signature) || [];
    group.push(row);
    groups.set(signature, group);
  }

  const written = [];
  for (const group of groups.values()) {
    const result = await supabaseAdminRequest(
      env,
      'aman_flight_states?on_conflict=service_date,airport,callsign&select=*',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(group),
      },
    );
    if (Array.isArray(result.data)) written.push(...result.data);
  }
  return written;
}

function recordForOutput(record, fallback) {
  return record ? { ...fallback, ...record } : fallback;
}

/**
 * Reconcile live IVAO sessions with shared AMAN flight identity.
 *
 * A callsign retains one canonical session id for up to 30 minutes after loss of
 * connection. Reconnection is checked against VID/departure/arrival identity and
 * last-position movement. Manual TLDT/runway and holding state are deliberately
 * untouched by this tracker reconciliation.
 */
export async function reconcileAmanFlights(env, airportValue, flightsValue, fetchedAtValue) {
  const airport = cleanAirport(airportValue);
  if (!airport) return Array.isArray(flightsValue) ? flightsValue : [];

  const fetchedAt = toIso(fetchedAtValue) || new Date().toISOString();
  const fetchedMs = toMillis(fetchedAt, Date.now());
  const serviceDate = utcServiceDate(fetchedAt);
  const flights = Array.isArray(flightsValue) ? flightsValue : [];
  const existing = await loadFlightStates(env, serviceDate, airport);
  const byCallsign = new Map(existing.map((record) => [String(record.callsign).toUpperCase(), record]));
  const seen = new Set();
  const pendingRows = [];
  const pendingOutput = [];

  for (const rawFlight of flights) {
    const callsign = cleanCallsign(rawFlight?.callsign);
    if (!callsign) continue;
    seen.add(callsign);

    let record = byCallsign.get(callsign) || null;
    const lastSeenMs = record ? toMillis(record.last_seen_at, 0) : 0;
    const expired = record
      && (record.connection_phase === 'EXPIRED' || fetchedMs - lastSeenMs > AMAN_GHOST_RETENTION_MS);
    if (record && (expired || hardIdentityConflict(record, rawFlight))) record = null;

    const canonicalSessionId = record?.canonical_session_id || crypto.randomUUID();
    const rawSessionId = cleanText(rawFlight?.sessionId, 128) || crypto.randomUUID();
    const previousSnapshot = record?.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {};
    const wasDisconnected = Boolean(record?.disconnected_at);
    const rawSessionChanged = Boolean(record?.raw_session_id && record.raw_session_id !== rawSessionId);
    const fallbackDtMs = Math.max(1000, fetchedMs - (lastSeenMs || fetchedMs - 1000));

    let connectionPhase = 'LIVE';
    let reconnectAt = null;
    let jumpNm = null;
    let expectedNm = null;

    if (record && (wasDisconnected || rawSessionChanged)) {
      const plausibility = reconnectPlausibility(previousSnapshot, rawFlight, fallbackDtMs);
      connectionPhase = plausibility.plausible ? 'RECONNECTED' : 'POSITION_JUMP';
      reconnectAt = fetchedAt;
      jumpNm = plausibility.jumpNm;
      expectedNm = plausibility.expectedNm;
    } else if (record?.reconnect_at && fetchedMs - toMillis(record.reconnect_at, 0) <= AMAN_RECONNECT_NOTICE_MS) {
      connectionPhase = record.connection_phase === 'POSITION_JUMP' ? 'POSITION_JUMP' : 'RECONNECTED';
      reconnectAt = record.reconnect_at;
      jumpNm = record.jump_nm == null ? null : Number(record.jump_nm);
      expectedNm = record.expected_nm == null ? null : Number(record.expected_nm);
    }

    const snapshot = {
      ...rawFlight,
      sessionId: canonicalSessionId,
      rawSessionId,
    };

    // ON BLOCKS / ON GROUND at the departure airport is a valid inbound that has
    // not departed yet. Only suppress it once the same terminal indication is at
    // the AMAN destination airport.
    const terminalNow = snapshot.predepartureLocal !== true
      && looksLandedAtAirport(snapshot, airport);
    const gaPatch = gaStatePatch(record, snapshot, airport, fetchedMs, terminalNow);

    const write = {
      service_date: serviceDate,
      airport,
      callsign,
      canonical_session_id: canonicalSessionId,
      raw_session_id: rawSessionId,
      vid: cleanText(rawFlight?.vid, 32),
      flight_plan_id: cleanText(rawFlight?.flightPlanId, 128),
      departure: cleanText(rawFlight?.departure, 8)?.toUpperCase() || null,
      arrival: cleanText(rawFlight?.arrival, 8)?.toUpperCase() || airport,
      aircraft_type: cleanText(rawFlight?.aircraft, 20)?.toUpperCase() || null,
      route: cleanText(rawFlight?.route, 4000)?.toUpperCase() || null,
      snapshot,
      last_seen_at: fetchedAt,
      disconnected_at: null,
      connection_phase: connectionPhase,
      reconnect_at: reconnectAt,
      jump_nm: jumpNm,
      expected_nm: expectedNm,
      ...gaPatch,
    };
    pendingRows.push(write);

    const effectiveRecord = { ...(record || {}), ...gaPatch };
    const missedReinsert = terminalNow && hasActiveMissedReinsert(effectiveRecord, snapshot, fetchedMs);
    if (terminalNow && !missedReinsert) continue;

    // While IVAO is still stale at LANDED after a controller-triggered GA, expose a
    // sequencing-only airborne view so the direct NOW+10 manual target can appear in
    // the table immediately. The stored snapshot remains the untouched IVAO sample.
    const sequencingSnapshot = missedReinsert
      ? { ...snapshot, state: 'initial climb', onGround: false, operationalReinsert: true }
      : snapshot;

    pendingOutput.push({
      callsign,
      flight: {
        ...sequencingSnapshot,
        ...sharedFields(recordForOutput(effectiveRecord, {
          connection_phase: connectionPhase,
          reconnect_at: reconnectAt,
          jump_nm: jumpNm,
          expected_nm: expectedNm,
        })),
      },
    });
  }

  for (const record of existing) {
    const callsign = String(record.callsign || '').trim().toUpperCase();
    if (!callsign || seen.has(callsign)) continue;

    const lastSeenMs = toMillis(record.last_seen_at, 0);
    const ageMs = fetchedMs - lastSeenMs;
    const snapshot = record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {};
    const landed = looksLandedAtAirport(snapshot, airport);
    const missedReinsert = hasActiveMissedReinsert(record, snapshot, fetchedMs);
    const retain = ageMs <= AMAN_GHOST_RETENTION_MS && (!landed || missedReinsert);

    if (!retain) {
      pendingRows.push({
        service_date: serviceDate,
        airport,
        callsign,
        canonical_session_id: record.canonical_session_id,
        connection_phase: 'EXPIRED',
        disconnected_at: record.disconnected_at || fetchedAt,
      });
      continue;
    }

    const disconnectedAt = record.disconnected_at || fetchedAt;
    pendingRows.push({
      service_date: serviceDate,
      airport,
      callsign,
      canonical_session_id: record.canonical_session_id,
      connection_phase: 'GHOST',
      disconnected_at: disconnectedAt,
      reconnect_at: null,
      jump_nm: null,
      expected_nm: null,
    });

    pendingOutput.push({
      callsign,
      flight: {
        ...snapshot,
        sessionId: record.canonical_session_id,
        rawSessionId: record.raw_session_id || null,
        state: missedReinsert ? 'initial climb' : 'DISCONNECTED',
        onGround: false,
        heading: missedReinsert ? snapshot.heading ?? null : null,
        operationalReinsert: missedReinsert || undefined,
        ...sharedFields({ ...record, connection_phase: 'GHOST', disconnected_at: disconnectedAt }),
      },
    });
  }

  const written = await writeFlightStates(env, pendingRows);
  const writtenByCallsign = new Map(written.map((record) => [String(record.callsign).toUpperCase(), record]));

  return pendingOutput
    .map(({ callsign, flight }) => ({
      ...flight,
      ...sharedFields(writtenByCallsign.get(callsign) || byCallsign.get(callsign)),
    }))
    .sort((left, right) => String(left.callsign).localeCompare(String(right.callsign)));
}
