import { activeAiracAirport } from '../../_lib/activeAiracAirports.js';

// Served behind the existing sequence authentication middleware, never a public asset.
// Fail closed when the staff activates a different source; do not mix AIRAC cycles.
export async function onRequestGet(context) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const airport = new URL(context.request.url).searchParams.get('airport')?.toUpperCase();
  if (!['VTCC', 'VTSP'].includes(airport)) return Response.json({ error: 'Unsupported regional airport' }, { status: 400, headers });
  try {
    return Response.json(await activeAiracAirport(context.env, airport), { headers });
  } catch (error) {
    const missing = error.code === 'AIRAC_PACKAGE_UNAVAILABLE';
    return Response.json({ error: missing ? error.message : 'Unable to verify active AIRAC; regional timing unavailable.', code: missing ? error.code : 'AIRAC_VERIFICATION_FAILED' }, { status: missing ? 409 : 503, headers });
  }
}
