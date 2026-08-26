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

// If a pilot disconnects immediately after touchdown, IVAO can disappear before
// the next Whazzup sample explicitly says LANDED/ON GROUND. In that case only
// release the slot when the last position is very close to the airport and the
// last groundspeed is already taxi/rollout-like. A short-final aircraft is still
// fast enough that it will remain protected as a GHOST rather than being dropped.
const LANDED_RELEASE_RADIUS_NM = 3.5;
const LANDED_RELEASE_MAX_GS_KT = 90;
const MISSED_REINSERT_RECENCY_MS = 2 * 60 * 1000;

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

function distanceNm(lat1, lon1, lat2, lon2) {
  const earthRadiusNm = 3440.065;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    holdingMode: record?.holding_mode || 'AUTO',
    holdingFix: record?.holding_fix || null,
    holdingLeaveAt: record?.holding_leave_at || null,
  };
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
  const result = await supabaseAdminRequest(
    env,
    'aman_flight_states?on_conflict=service_date,airport,callsign&select=*',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows),
    },
  );
  return Array.isArray(result.data) ? result.data : [];
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
    };
    pendingRows.push(write);

    // ON BLOCKS / ON GROUND at the departure airport is a valid inbound that has
    // not departed yet. Only suppress it once the same terminal indication is at
    // the AMAN destination airport.
    const terminalNow = looksLandedAtAirport(snapshot, airport);
    const missedReinsert = terminalNow && hasActiveMissedReinsert(record, snapshot, fetchedMs);
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
        ...sharedFields(recordForOutput(record, {
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
