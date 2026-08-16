import { actorPatch, supabaseAdminRequest } from "../../_lib/supabaseAdmin.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function cleanText(value, max = 120) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function readSession(env, id) {
  const sessionResult = await supabaseAdminRequest(env, `sequence_sessions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const session = sessionResult.data?.[0];
  if (!session) throw new Error("Session not found");
  const arrivalsResult = await supabaseAdminRequest(env, `arrival_sequence_view?session_id=eq.${encodeURIComponent(id)}&select=*&order=sequence_no.asc,cldt.asc`);
  return { session, arrivals: arrivalsResult.data ?? [] };
}

async function updateSession(env, auth, payload) {
  const id = cleanText(payload.id, 64);
  if (!id) throw new Error("Session id is required");
  const patch = { ...actorPatch(auth) };
  const action = payload.sessionAction;

  if (action === "close") {
    patch.status = "CLOSED";
    patch.closed_at = new Date().toISOString();
  } else if (action === "reopen") {
    patch.status = "ACTIVE";
    patch.closed_at = null;
    patch.archived = false;
  } else if (action === "archive") {
    patch.archived = true;
    patch.status = "CLOSED";
    patch.closed_at = new Date().toISOString();
  } else if (action === "restore") {
    patch.archived = false;
  } else {
    throw new Error("Unsupported session action");
  }

  return supabaseAdminRequest(env, `sequence_sessions?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const id = cleanText(url.searchParams.get("id"), 64);
    if (!id) return json({ error: "Session id is required" }, 400);
    return json(await readSession(context.env, id));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const result = await updateSession(context.env, context.data.auth, payload);
    return json({ ok: true, data: result.data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
