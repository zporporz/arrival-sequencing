import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const days = boundedInteger(url.searchParams.get('days'), 7, 1, 90);
    const limit = boundedInteger(url.searchParams.get('limit'), 250, 1, 500);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabaseAdminRequest(
      context.env,
      `ivao_login_audit?select=*&logged_in_at=gte.${encodeURIComponent(cutoff)}&order=logged_in_at.desc&limit=${limit}`,
    );
    const events = Array.isArray(result.data) ? result.data : [];
    const uniqueVids = new Set(events.map((event) => String(event.vid))).size;
    return json({
      days,
      limit,
      eventCount: events.length,
      uniqueVids,
      events,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
