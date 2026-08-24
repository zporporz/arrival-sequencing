import { supabaseAdminRequest } from "../_lib/supabaseAdmin.js";
import { getRequestSession } from "../_lib/session.js";

export async function onRequestGet(context) {
  try {
    const session = await getRequestSession(context.request, context.env);
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const airports = await supabaseAdminRequest(
      context.env,
      "airports?select=id,icao,name,city,fir,active,published&active=eq.true&published=eq.true&order=icao.asc",
    );
    const runwayConfigs = await supabaseAdminRequest(
      context.env,
      "runway_configs?select=id,airport_id,flow,label,timing_status,active,published,sort_order&active=eq.true&published=eq.true&order=sort_order.asc,flow.asc",
    );
    const starProcedures = await supabaseAdminRequest(
      context.env,
      "star_procedures?select=id,runway_config_id,designator,entry_fix,effective_from,effective_to,active&active=eq.true&order=designator.asc",
    );

    return Response.json({
      airports: airports.data ?? [],
      runwayConfigs: runwayConfigs.data ?? [],
      starProcedures: starProcedures.data ?? [],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
