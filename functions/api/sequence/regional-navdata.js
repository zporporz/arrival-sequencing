import data from '../../_data/regional-arrivals.json';
import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

// Served behind the existing sequence authentication middleware, never a public asset.
// Fail closed when the staff activates a different source; do not mix AIRAC cycles.
export async function onRequestGet(context) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const airport = new URL(context.request.url).searchParams.get('airport')?.toUpperCase();
  if (!['VTCC', 'VTSP'].includes(airport)) return Response.json({ error: 'Unsupported regional airport' }, { status: 400, headers });
  try {
    const { data: cycles } = await supabaseAdminRequest(context.env,
      'navdata_cycles?status=eq.ACTIVE&select=cycle,source_sha256&limit=1');
    const active = cycles?.[0];
    if (!active || active.cycle !== data.cycle || active.source_sha256 !== data.sourceSha256) {
      return Response.json({ error: 'Regional STAR/approach package must be regenerated from the active AIRAC SQLite.',
        code: 'REGIONAL_AIRAC_MISMATCH', activeCycle: active?.cycle ?? null, packageCycle: data.cycle }, { status: 409, headers });
    }
    return Response.json({ cycle: data.cycle, source: data.source, airport: data.airports[airport] }, { headers });
  } catch {
    return Response.json({ error: 'Unable to verify active AIRAC; regional timing unavailable.' }, { status: 503, headers });
  }
}
