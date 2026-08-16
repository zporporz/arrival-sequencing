import { supabaseAdminRequest } from "../../_lib/supabaseAdmin.js";

export async function onRequestGet(context) {
  try {
    const [airports, runways, timings, sessions] = await Promise.all([
      supabaseAdminRequest(context.env, "airports?select=id,icao,active,published&active=eq.true&published=eq.true&order=icao.asc"),
      supabaseAdminRequest(context.env, "runway_configs?select=id,airport_id,flow,label,timing_status,active,published&active=eq.true&published=eq.true&order=sort_order.asc"),
      supabaseAdminRequest(context.env, "fix_timings?select=id,runway_config_id,airport,flow,fix,active,verified&active=eq.true"),
      supabaseAdminRequest(context.env, "sequence_sessions?select=id,airport,flow,service_date,status,archived&status=eq.ACTIVE&archived=eq.false"),
    ]);

    const timingCounts = new Map();
    for (const timing of timings.data ?? []) {
      const key = timing.runway_config_id || `${timing.airport}:${timing.flow}`;
      timingCounts.set(key, (timingCounts.get(key) || 0) + 1);
    }

    const workspaceChecks = (runways.data ?? []).map((runway) => ({
      runwayConfigId: runway.id,
      flow: runway.flow,
      label: runway.label,
      timingStatus: runway.timing_status,
      activeTimingCount: timingCounts.get(runway.id) || 0,
      ready: runway.timing_status === "ACTIVE" && (timingCounts.get(runway.id) || 0) > 0,
    }));

    return Response.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      publishedAirports: airports.data ?? [],
      publishedRunways: workspaceChecks,
      activeSessions: sessions.data ?? [],
      security: {
        liveWrites: "Cloudflare authenticated sequence API",
        browserSupabaseWrites: "disabled by database grants/RLS",
        adminAccess: "Thailand Division staff",
      },
      healthy: workspaceChecks.every((item) => item.timingStatus !== "ACTIVE" || item.activeTimingCount > 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
