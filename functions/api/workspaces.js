import { supabaseAdminRequest } from "../_lib/supabaseAdmin.js";

export async function onRequestGet(context) {
  try {
    const airports = await supabaseAdminRequest(
      context.env,
      "airports?select=id,icao,name,city,fir,active,published&active=eq.true&published=eq.true&order=icao.asc",
    );
    const runwayConfigs = await supabaseAdminRequest(
      context.env,
      "runway_configs?select=id,airport_id,flow,label,timing_status,active,published,sort_order&active=eq.true&published=eq.true&order=sort_order.asc,flow.asc",
    );

    return Response.json({
      airports: airports.data ?? [],
      runwayConfigs: runwayConfigs.data ?? [],
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
