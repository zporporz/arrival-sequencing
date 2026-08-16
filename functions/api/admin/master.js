import { actorPatch, creatorPatch, supabaseAdminRequest } from "../../_lib/supabaseAdmin.js";

const json = (body, status = 200) => Response.json(body, { status });

function cleanText(value, max = 120) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function readDashboard(env) {
  const [airports, runways, stars, history, timings, sessions] = await Promise.all([
    supabaseAdminRequest(env, "airports?select=*&order=icao.asc"),
    supabaseAdminRequest(env, "runway_configs?select=*&order=sort_order.asc,flow.asc"),
    supabaseAdminRequest(env, "star_procedures?select=*&order=designator.asc"),
    supabaseAdminRequest(env, "config_history?select=*&order=changed_at.desc&limit=150"),
    supabaseAdminRequest(env, "fix_timings?select=*&order=airport.asc,flow.asc,fix.asc"),
    supabaseAdminRequest(env, "sequence_sessions?select=*&order=service_date.desc,created_at.desc&limit=100"),
  ]);
  return {
    airports: airports.data ?? [],
    runwayConfigs: runways.data ?? [],
    starProcedures: stars.data ?? [],
    history: history.data ?? [],
    fixTimings: timings.data ?? [],
    sessions: sessions.data ?? [],
  };
}

async function insertAirport(env, auth, payload) {
  const icao = cleanText(payload.icao, 4)?.toUpperCase();
  const name = cleanText(payload.name, 160);
  if (!icao || !/^[A-Z]{4}$/.test(icao)) throw new Error("ICAO must be 4 letters");
  if (!name) throw new Error("Airport name is required");
  return supabaseAdminRequest(env, "airports?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      icao,
      name,
      city: cleanText(payload.city, 120),
      fir: cleanText(payload.fir, 80)?.toUpperCase() || "BANGKOK",
      active: payload.active !== false,
      published: Boolean(payload.published),
      ...creatorPatch(auth),
    }]),
  });
}

async function updateAirport(env, auth, payload) {
  const id = cleanText(payload.id, 64);
  if (!id) throw new Error("Airport id is required");
  const patch = { ...actorPatch(auth) };
  if (payload.name !== undefined) patch.name = cleanText(payload.name, 160);
  if (payload.city !== undefined) patch.city = cleanText(payload.city, 120);
  if (payload.fir !== undefined) patch.fir = cleanText(payload.fir, 80)?.toUpperCase() || "BANGKOK";
  if (payload.published !== undefined) patch.published = Boolean(payload.published);
  if (payload.active !== undefined) {
    patch.active = Boolean(payload.active);
    patch.archived_at = patch.active ? null : new Date().toISOString();
    if (!patch.active) patch.published = false;
  }
  return supabaseAdminRequest(env, `airports?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

async function insertRunway(env, auth, payload) {
  const airportId = cleanText(payload.airportId, 64);
  const flow = cleanText(payload.flow, 32);
  const label = cleanText(payload.label, 80);
  if (!airportId || !flow || !label) throw new Error("Airport, flow and label are required");
  const timingStatus = ["ACTIVE", "PENDING", "DISABLED"].includes(payload.timingStatus) ? payload.timingStatus : "PENDING";
  return supabaseAdminRequest(env, "runway_configs?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      airport_id: airportId,
      flow,
      label,
      timing_status: timingStatus,
      active: payload.active !== false,
      published: Boolean(payload.published),
      sort_order: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
      notes: cleanText(payload.notes, 500),
      ...creatorPatch(auth),
    }]),
  });
}

async function updateRunway(env, auth, payload) {
  const id = cleanText(payload.id, 64);
  if (!id) throw new Error("Runway config id is required");
  const patch = { ...actorPatch(auth) };
  if (payload.label !== undefined) patch.label = cleanText(payload.label, 80);
  if (payload.timingStatus !== undefined && ["ACTIVE", "PENDING", "DISABLED"].includes(payload.timingStatus)) patch.timing_status = payload.timingStatus;
  if (payload.published !== undefined) patch.published = Boolean(payload.published);
  if (payload.active !== undefined) {
    patch.active = Boolean(payload.active);
    if (!patch.active) patch.published = false;
  }
  if (payload.notes !== undefined) patch.notes = cleanText(payload.notes, 500);
  if (payload.sortOrder !== undefined) patch.sort_order = Number(payload.sortOrder) || 0;
  return supabaseAdminRequest(env, `runway_configs?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

async function insertStar(env, auth, payload) {
  const runwayConfigId = cleanText(payload.runwayConfigId, 64);
  const designator = cleanText(payload.designator, 40)?.toUpperCase();
  if (!runwayConfigId || !designator) throw new Error("Runway configuration and STAR designator are required");
  return supabaseAdminRequest(env, "star_procedures?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      runway_config_id: runwayConfigId,
      designator,
      entry_fix: cleanText(payload.entryFix, 20)?.toUpperCase(),
      runway_applicability: cleanText(payload.runwayApplicability, 120),
      chart_reference: cleanText(payload.chartReference, 200),
      source: cleanText(payload.source, 300),
      effective_from: cleanText(payload.effectiveFrom, 10),
      effective_to: cleanText(payload.effectiveTo, 10),
      active: payload.active !== false,
      ...creatorPatch(auth),
    }]),
  });
}

async function updateStar(env, auth, payload) {
  const id = cleanText(payload.id, 64);
  if (!id) throw new Error("STAR id is required");
  const patch = { ...actorPatch(auth) };
  const fields = {
    designator: "designator",
    entryFix: "entry_fix",
    runwayApplicability: "runway_applicability",
    chartReference: "chart_reference",
    source: "source",
    effectiveFrom: "effective_from",
    effectiveTo: "effective_to",
  };
  for (const [input, column] of Object.entries(fields)) {
    if (payload[input] !== undefined) patch[column] = cleanText(payload[input], column.includes("source") || column.includes("reference") ? 300 : 120);
  }
  if (patch.designator) patch.designator = patch.designator.toUpperCase();
  if (patch.entry_fix) patch.entry_fix = patch.entry_fix.toUpperCase();
  if (payload.active !== undefined) patch.active = Boolean(payload.active);
  return supabaseAdminRequest(env, `star_procedures?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

async function insertTiming(env, auth, payload) {
  const runwayConfigId = cleanText(payload.runwayConfigId, 64);
  const airport = cleanText(payload.airport, 4)?.toUpperCase();
  const flow = cleanText(payload.flow, 32);
  const fix = cleanText(payload.fix, 20)?.toUpperCase();
  const minutes = Number(payload.nominalMinutes);
  if (!runwayConfigId || !airport || !flow || !fix) throw new Error("Runway configuration, airport, flow and reference fix are required");
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) throw new Error("Nominal minutes must be between 0 and 180");
  const effectiveFrom = cleanText(payload.effectiveFrom, 10) || new Date().toISOString().slice(0, 10);
  const source = cleanText(payload.source, 500) || "Manual admin entry; provisional planning timing";
  return supabaseAdminRequest(env, "fix_timings?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      runway_config_id: runwayConfigId,
      airport,
      flow,
      fix,
      nominal_seconds: Math.round(minutes * 60),
      source,
      verified: Boolean(payload.verified),
      effective_from: effectiveFrom,
      effective_to: cleanText(payload.effectiveTo, 10),
      active: payload.active !== false,
      ...creatorPatch(auth),
    }]),
  });
}

async function updateTiming(env, auth, payload) {
  const id = Number(payload.id);
  if (!Number.isFinite(id)) throw new Error("Timing id is required");
  const patch = { ...actorPatch(auth) };
  if (payload.nominalMinutes !== undefined) {
    const minutes = Number(payload.nominalMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) throw new Error("Nominal minutes must be between 0 and 180");
    patch.nominal_seconds = Math.round(minutes * 60);
  }
  if (payload.source !== undefined) {
    const source = cleanText(payload.source, 500);
    if (!source) throw new Error("Timing source is required");
    patch.source = source;
  }
  if (payload.verified !== undefined) patch.verified = Boolean(payload.verified);
  if (payload.active !== undefined) patch.active = Boolean(payload.active);
  if (payload.effectiveTo !== undefined) patch.effective_to = cleanText(payload.effectiveTo, 10);
  return supabaseAdminRequest(env, `fix_timings?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

async function restoreHistory(env, auth, payload) {
  const historyId = Number(payload.historyId);
  if (!Number.isFinite(historyId)) throw new Error("History id is required");
  const historyResult = await supabaseAdminRequest(env, `config_history?id=eq.${historyId}&select=*&limit=1`);
  const item = historyResult.data?.[0];
  if (!item) throw new Error("History revision not found");
  if (!item.old_row) throw new Error("This revision has no previous snapshot to restore");

  const tableByType = {
    AIRPORT: "airports",
    RUNWAY_CONFIG: "runway_configs",
    STAR_PROCEDURE: "star_procedures",
    FIX_TIMING: "fix_timings",
  };
  const table = tableByType[item.entity_type];
  if (!table) throw new Error("Restore is not supported for this entity type yet");

  const snapshot = { ...item.old_row };
  for (const key of ["id", "created_at", "created_by_vid", "created_by_name", "updated_at", "updated_by_vid", "updated_by_name"]) delete snapshot[key];
  Object.assign(snapshot, actorPatch(auth));
  if (table === "airports" && snapshot.active === true) snapshot.archived_at = null;

  return supabaseAdminRequest(env, `${table}?id=eq.${encodeURIComponent(item.entity_id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(snapshot),
  });
}

export async function onRequestGet(context) {
  try {
    return json(await readDashboard(context.env));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const payload = await context.request.json();
    const action = payload.action;
    let result;
    if (action === "airport.create") result = await insertAirport(context.env, auth, payload);
    else if (action === "airport.update") result = await updateAirport(context.env, auth, payload);
    else if (action === "runway.create") result = await insertRunway(context.env, auth, payload);
    else if (action === "runway.update") result = await updateRunway(context.env, auth, payload);
    else if (action === "star.create") result = await insertStar(context.env, auth, payload);
    else if (action === "star.update") result = await updateStar(context.env, auth, payload);
    else if (action === "timing.create") result = await insertTiming(context.env, auth, payload);
    else if (action === "timing.update") result = await updateTiming(context.env, auth, payload);
    else if (action === "history.restore") result = await restoreHistory(context.env, auth, payload);
    else return json({ error: "Unsupported admin action" }, 400);
    return json({ ok: true, data: result.data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
