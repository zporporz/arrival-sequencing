import { getSimbriefAircraftPerformance } from '../../_lib/simbriefPerformance.js';

const json = (body, status = 200, cache = 'public, max-age=300, s-maxage=21600') => Response.json(body, {
  status,
  headers: { 'Cache-Control': cache },
});

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const type = String(url.searchParams.get('type') || '').trim().toUpperCase();
    if (!type) return json({ error: 'Aircraft type is required' }, 400, 'no-store');

    const profile = await getSimbriefAircraftPerformance(context.env, type);
    if (!profile) {
      return json({
        type,
        found: false,
        source: 'SIMBRIEF',
        fallback: {
          descentMach: null,
          descentIasKt: 280,
          descentBelow10000IasKt: 250,
        },
      }, 404);
    }

    return json({ type, found: true, profile });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500, 'no-store');
  }
}
