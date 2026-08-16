import { supabaseAdminRequest } from "../../_lib/supabaseAdmin.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ALLOWED_FIELDS = new Set(["callsign", "aircraft_type", "departure", "ref_fix", "eto", "cldt", "aldt", "status", "note"]);
const ALLOWED_STATUSES = new Set(["INBOUND", "SEQUENCED", "LANDING", "LANDED", "CANCELLED"]);

function clean(value, max = 200) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function getActiveSession(env, id) {
  const result = await supabaseAdminRequest(env, `sequence_sessions?select=*&id=eq.${encodeURIComponent(id)}&status=eq.ACTIVE&archived=eq.false&limit=1`);
  const session = result.data?.[0];
  if (!session) throw new Error("Live sequence session is not active");
  return session;
}

async function getArrival(env, id) {
  const result = await supabaseAdminRequest(env, `arrivals?select=id,session_id,status&id=eq.${encodeURIComponent(id)}&limit=1`);
  const arrival = result.data?.[0];
  if (!arrival) throw new Error("Arrival not found");
  await getActiveSession(env, arrival.session_id);
  return arrival;
}

function actorLabel(auth) {
  return String(auth.vid || auth.name || "IVAO");
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const action = String(payload.action || "");
    const auth = context.data.auth;
    const label = actorLabel(auth);

    if (action === "create") {
      const sessionId = clean(payload.sessionId, 64);
      const sequenceNo = Number(payload.sequenceNo);
      const refFix = clean(payload.refFix, 20)?.toUpperCase();
      const eto = clean(payload.eto, 64);
      if (!sessionId || !Number.isInteger(sequenceNo) || sequenceNo < 1 || !refFix || !eto) throw new Error("Session, sequence number, reference fix and ETO are required");
      await getActiveSession(context.env, sessionId);
      const result = await supabaseAdminRequest(context.env, "arrivals?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          session_id: sessionId,
          sequence_no: sequenceNo,
          callsign: clean(payload.callsign, 20)?.toUpperCase() || "NEW",
          aircraft_type: clean(payload.aircraftType, 20)?.toUpperCase(),
          departure: clean(payload.departure, 20)?.toUpperCase(),
          ref_fix: refFix,
          eto,
          status: "INBOUND",
          created_by_label: label,
          updated_by_label: label,
        }]),
      });
      return json({ ok: true, data: result.data?.[0] ?? null });
    }

    const id = clean(payload.id, 64);
    if (!id) throw new Error("Arrival id is required");
    await getArrival(context.env, id);

    if (action === "update") {
      const patch = { updated_by_label: label };
      const values = payload.values && typeof payload.values === "object" ? payload.values : {};
      for (const [field, value] of Object.entries(values)) {
        if (!ALLOWED_FIELDS.has(field)) continue;
        if (field === "status") {
          const status = String(value || "").toUpperCase();
          if (!ALLOWED_STATUSES.has(status)) throw new Error("Invalid arrival status");
          patch.status = status;
        } else if (["callsign", "aircraft_type", "departure", "ref_fix"].includes(field)) {
          patch[field] = clean(value, 30)?.toUpperCase();
        } else if (["eto", "cldt", "aldt"].includes(field)) {
          patch[field] = value == null || value === "" ? null : clean(value, 64);
        } else {
          patch[field] = clean(value, 500);
        }
      }
      if (Object.keys(patch).length === 1) throw new Error("No editable fields supplied");
      const result = await supabaseAdminRequest(context.env, `arrivals?id=eq.${encodeURIComponent(id)}&select=*`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      return json({ ok: true, data: result.data?.[0] ?? null });
    }

    if (action === "delete") {
      await supabaseAdminRequest(context.env, `arrivals?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ updated_by_label: label }),
      });
      await supabaseAdminRequest(context.env, `arrivals?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return json({ ok: true });
    }

    throw new Error("Unsupported arrival action");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
