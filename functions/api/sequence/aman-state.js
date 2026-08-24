import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';
import { utcServiceDate } from '../../_lib/amanSharedState.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

const DEFAULT_WORKSPACE_SETTINGS = {
  holdingThresholdMinutes: 9,
  speedAdvisoryEnabled: true,
  processingRadiusNm: 300,
  processingRadiusBandMinNm: 200,
  etaFfRefreshSeconds: 15,
  approachDelayBudgetMinutes: 4,
  vtbsArrivalCapacityMaxPerHour: 37,
};

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

function cleanRunway(value) {
  const runway = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(runway) ? runway : null;
}

function cleanOrderedCallsigns(value) {
  if (!Array.isArray(value)) throw new Error('orderedCallsigns must be an array');
  if (value.length > 200) throw new Error('Sequence order is too large');
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const callsign = cleanCallsign(item);
    if (!callsign || seen.has(callsign)) throw new Error('Sequence callsigns must be valid and unique');
    seen.add(callsign);
    result.push(callsign);
  }
  return result;
}

function cleanServiceDate(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : utcServiceDate();
}

function cleanIso(value, required = false) {
  if (value == null || value === '') {
    if (required) throw new Error('UTC time is required');
    return null;
  }
  const millis = new Date(String(value)).getTime();
  if (!Number.isFinite(millis)) throw new Error('Invalid UTC time');
  return new Date(millis).toISOString();
}

function cleanObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function actor(auth) {
  return {
    vid: cleanText(auth?.vid, 32),
    name: cleanText(auth?.name, 120) || cleanText(auth?.vid, 32) || 'IVAO',
  };
}

async function getFlightState(env, serviceDate, airport, callsign) {
  const result = await supabaseAdminRequest(
    env,
    `aman_flight_states?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&airport=eq.${encodeURIComponent(airport)}&callsign=eq.${encodeURIComponent(callsign)}&limit=1`,
  );
  return result.data?.[0] || null;
}

async function upsertFlightState(env, row) {
  const result = await supabaseAdminRequest(
    env,
    'aman_flight_states?on_conflict=service_date,airport,callsign&select=*',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([row]),
    },
  );
  return result.data?.[0] || null;
}

async function patchFlightState(env, serviceDate, airport, callsign, patch) {
  const result = await supabaseAdminRequest(
    env,
    `aman_flight_states?service_date=eq.${encodeURIComponent(serviceDate)}&airport=eq.${encodeURIComponent(airport)}&callsign=eq.${encodeURIComponent(callsign)}&select=*`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  return result.data?.[0] || null;
}

function flightIdentityRow(existing, payload, serviceDate, airport, callsign) {
  return {
    service_date: serviceDate,
    airport,
    callsign,
    canonical_session_id: existing?.canonical_session_id
      || cleanText(payload.canonicalSessionId, 128)
      || crypto.randomUUID(),
  };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const serviceDate = cleanServiceDate(url.searchParams.get('serviceDate'));
    const airports = String(url.searchParams.get('airports') || 'VTBD,VTBS')
      .split(',')
      .map(cleanAirport)
      .filter(Boolean);
    if (!airports.length) throw new Error('At least one airport is required');

    const airportFilter = airports.map((airport) => `\"${airport}\"`).join(',');
    const [workspaceResult, flightResult, sequenceResult] = await Promise.all([
      supabaseAdminRequest(
        context.env,
        `aman_workspace_states?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&airport=in.(${encodeURIComponent(airportFilter)})`,
      ),
      supabaseAdminRequest(
        context.env,
        `aman_flight_states?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&airport=in.(${encodeURIComponent(airportFilter)})&connection_phase=neq.EXPIRED`,
      ),
      supabaseAdminRequest(
        context.env,
        `aman_sequence_orders?select=*&service_date=eq.${encodeURIComponent(serviceDate)}&airport=in.(${encodeURIComponent(airportFilter)})`,
      ),
    ]);

    return json({
      serviceDate,
      workspaceStates: workspaceResult.data || [],
      flightStates: flightResult.data || [],
      sequenceOrders: sequenceResult.data || [],
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const action = String(payload?.action || '').trim();
    const serviceDate = cleanServiceDate(payload?.serviceDate);
    const auth = actor(context.data.auth);

    if (action === 'syncWorkspace') {
      const airport = cleanAirport(payload.airport);
      if (!airport) throw new Error('Valid airport is required');
      const profileId = cleanText(payload.profileId, 120) || 'CUSTOM';
      const runwayModes = cleanObject(payload.runwayModes, 'runwayModes');
      const spacingNm = cleanObject(payload.spacingNm, 'spacingNm');
      const suppliedSettings = payload.settings == null
        ? {}
        : cleanObject(payload.settings, 'settings');
      const settings = { ...suppliedSettings, ...DEFAULT_WORKSPACE_SETTINGS };

      const result = await supabaseAdminRequest(
        context.env,
        'aman_workspace_states?on_conflict=service_date,airport&select=*',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify([{
            service_date: serviceDate,
            airport,
            profile_id: profileId,
            runway_modes: runwayModes,
            spacing_nm: spacingNm,
            settings,
            updated_by_vid: auth.vid,
            updated_by_name: auth.name,
          }]),
        },
      );
      return json({ ok: true, workspaceState: result.data?.[0] || null });
    }

    if (action === 'setSequenceOrder') {
      const airport = cleanAirport(payload.airport);
      const runway = cleanRunway(payload.runway);
      const orderedCallsigns = cleanOrderedCallsigns(payload.orderedCallsigns);
      if (!airport || !runway) throw new Error('Valid airport and runway are required');

      const result = await supabaseAdminRequest(
        context.env,
        'aman_sequence_orders?on_conflict=service_date,airport,runway&select=*',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify([{
            service_date: serviceDate,
            airport,
            runway,
            ordered_callsigns: orderedCallsigns,
            updated_by_vid: auth.vid,
            updated_by_name: auth.name,
          }]),
        },
      );
      return json({ ok: true, sequenceOrder: result.data?.[0] || null });
    }

    const airport = cleanAirport(payload.airport);
    const callsign = cleanCallsign(payload.callsign);
    if (!airport || !callsign) throw new Error('Airport and callsign are required');
    const existing = await getFlightState(context.env, serviceDate, airport, callsign);

    if (action === 'setManualTarget') {
      const manualTldt = cleanIso(payload.manualTldt, true);
      const manualRunway = cleanText(payload.manualRunway, 12)?.toUpperCase();
      if (!manualRunway) throw new Error('Landing runway is required');

      const row = await upsertFlightState(context.env, {
        ...flightIdentityRow(existing, payload, serviceDate, airport, callsign),
        target_mode: 'MANUAL',
        manual_tldt: manualTldt,
        manual_runway: manualRunway,
        manual_updated_by_vid: auth.vid,
        manual_updated_by_name: auth.name,
        manual_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, flightState: row });
    }

    if (action === 'setMissedApproachTarget') {
      const manualTldt = cleanIso(payload.manualTldt, true);
      const suppliedRunway = cleanText(payload.manualRunway, 12)?.toUpperCase() || null;
      const manualRunway = suppliedRunway || existing?.manual_runway || null;
      const updatedAt = new Date().toISOString();

      const row = await upsertFlightState(context.env, {
        ...flightIdentityRow(existing, payload, serviceDate, airport, callsign),
        // Reinsert immediately into the active sequence. The future MANUAL target is
        // the missed-approach protection; landed-history capture suppresses it until
        // that target has passed, so the aircraft cannot instantly become LANDED again.
        operational_state: 'NORMAL',
        target_mode: 'MANUAL',
        manual_tldt: manualTldt,
        manual_runway: manualRunway,
        manual_updated_by_vid: auth.vid,
        manual_updated_by_name: auth.name,
        manual_updated_at: updatedAt,
        operational_updated_by_vid: auth.vid,
        operational_updated_by_name: auth.name,
        operational_updated_at: updatedAt,
      });
      return json({ ok: true, flightState: row });
    }

    if (action === 'clearManualTarget') {
      if (!existing) return json({ ok: true, flightState: null });
      const row = await patchFlightState(context.env, serviceDate, airport, callsign, {
        target_mode: 'AUTO',
        manual_tldt: null,
        manual_runway: null,
        manual_updated_by_vid: auth.vid,
        manual_updated_by_name: auth.name,
        manual_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, flightState: row });
    }

    if (action === 'setHolding') {
      const mode = String(payload.holdingMode || 'AUTO').trim().toUpperCase();
      if (!['AUTO', 'HOLD', 'NO_HOLD'].includes(mode)) throw new Error('Invalid holding mode');
      const holdingFix = cleanText(payload.holdingFix, 20)?.toUpperCase() || null;
      const holdingLeaveAt = cleanIso(payload.holdingLeaveAt, false);

      const row = await upsertFlightState(context.env, {
        ...flightIdentityRow(existing, payload, serviceDate, airport, callsign),
        holding_mode: mode,
        holding_fix: mode === 'NO_HOLD' ? null : holdingFix,
        holding_leave_at: mode === 'NO_HOLD' ? null : holdingLeaveAt,
        manual_updated_by_vid: auth.vid,
        manual_updated_by_name: auth.name,
        manual_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, flightState: row });
    }

    if (action === 'setOperationalState') {
      const operationalState = String(payload.operationalState || 'NORMAL').trim().toUpperCase();
      if (!['NORMAL', 'MISSED_APPROACH', 'DESEQUENCED', 'REMOVED'].includes(operationalState)) {
        throw new Error('Invalid operational state');
      }
      const row = await upsertFlightState(context.env, {
        ...flightIdentityRow(existing, payload, serviceDate, airport, callsign),
        operational_state: operationalState,
        operational_updated_by_vid: auth.vid,
        operational_updated_by_name: auth.name,
        operational_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, flightState: row });
    }

    if (action === 'setOperationalGap') {
      const seconds = Math.round(Number(payload.reservedGapSeconds));
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) throw new Error('Reserved gap must be between 0 and 600 seconds');
      const row = await upsertFlightState(context.env, {
        ...flightIdentityRow(existing, payload, serviceDate, airport, callsign),
        reserved_gap_seconds: seconds,
        operational_updated_by_vid: auth.vid,
        operational_updated_by_name: auth.name,
        operational_updated_at: new Date().toISOString(),
      });
      return json({ ok: true, flightState: row });
    }

    throw new Error('Unsupported AMAN state action');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
