import { activeFinalApproaches } from '../../_lib/finalApproaches.js';

// Inherits sequence auth middleware; licensed navdata is never a public asset.
export async function onRequestGet(context) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const airport = new URL(context.request.url).searchParams.get('airport')?.toUpperCase();
  if (!['VTBD', 'VTBS', 'VTCC', 'VTSP'].includes(airport)) return Response.json({ error: 'Unsupported airport' }, { status: 400, headers });
  try {
    return Response.json(await activeFinalApproaches(context.env, airport), { headers });
  } catch {
    return Response.json({ error: 'Verified active AIRAC approach data unavailable; use aligned Final gate.' }, { status: 503, headers });
  }
}
