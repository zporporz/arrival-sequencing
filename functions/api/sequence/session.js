import { supabaseAdminRequest } from "../../_lib/supabaseAdmin.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function clean(value, max = 120) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

async function resolvePublishedWorkspace(env, airport, flow) {
  const airports = await supabaseAdminRequest(env, `airports?select=id,icao,active,published&icao=eq.${encodeURIComponent(airport)}&active=eq.true&published=eq.true&limit=1`);
  const airportRow = airports.data?.[0];
  if (!airportRow) throw new Error("Airport is not published");

  const runways = await supabaseAdminRequest(env, `runway_configs?select=id,airport_id,flow,label,timing_status,active,published&airport_id=eq.${encodeURIComponent(airportRow.id)}&flow=eq.${encodeURIComponent(flow)}&active=eq.true&published=eq.true&limit=1`);
  const runway = runways.data?.[0];
  if (!runway) throw new Error("Runway configuration is not published");
  return runway;
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const airport = clean(payload.airport, 4).toUpperCase();
    const flow = clean(payload.flow, 32);
    if (!/^[A-Z0-9]{4}$/.test(airport) || !flow) return json({ error: "Airport and flow are required" }, 400);

    const runway = await resolvePublishedWorkspace(context.env, airport, flow);
    const todayUtc = new Date().toISOString().slice(0, 10);

    const existing = await supabaseAdminRequest(context.env, `sequence_sessions?select=*&airport=eq.${encodeURIComponent(airport)}&flow=eq.${encodeURIComponent(flow)}&service_date=eq.${todayUtc}&status=eq.ACTIVE&archived=eq.false&order=created_at.desc&limit=1`);
    if (existing.data?.[0]) return json({ session: existing.data[0], timingReady: runway.timing_status === "ACTIVE" });

    try {
      const created = await supabaseAdminRequest(context.env, "sequence_sessions?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{
          airport,
          flow,
          runway_config: runway.label,
          service_date: todayUtc,
          status: "ACTIVE",
          archived: false,
          updated_by_vid: String(context.data.auth.vid),
          updated_by_name: context.data.auth.name || null,
        }]),
      });
      return json({ session: created.data?.[0] ?? null, timingReady: runway.timing_status === "ACTIVE" });
    } catch (error) {
      if (!/duplicate key|unique constraint/i.test(String(error?.message || error))) throw error;
      const raced = await supabaseAdminRequest(context.env, `sequence_sessions?select=*&airport=eq.${encodeURIComponent(airport)}&flow=eq.${encodeURIComponent(flow)}&service_date=eq.${todayUtc}&status=eq.ACTIVE&archived=eq.false&order=created_at.desc&limit=1`);
      return json({ session: raced.data?.[0] ?? null, timingReady: runway.timing_status === "ACTIVE" });
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
