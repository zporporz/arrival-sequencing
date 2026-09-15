import { createAiracRouteResolver, normalizeRunway } from '../../_lib/airacRouteResolver.js';

const getGeometry = createAiracRouteResolver();
const clean = (value) => String(value || '').trim().toUpperCase();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON request' }, 400); }
  const origin = clean(body?.origin), destination = clean(body?.destination), route = clean(body?.route).replace(/\s+/g, ' ');
  const departureRunway = body?.departureRunway == null ? null : normalizeRunway(body.departureRunway);
  const arrivalRunway = body?.arrivalRunway == null ? null : normalizeRunway(body.arrivalRunway);
  const cycle = body?.cycle == null ? null : clean(body.cycle);
  const entryFix = body?.entryFix == null ? null : clean(body.entryFix);
  const selectedStar = body?.selectedStar == null ? null : clean(body.selectedStar);
  if (!/^[A-Z]{4}$/.test(origin) || !/^[A-Z]{4}$/.test(destination) || !route || route.length > 2000
    || (body?.departureRunway != null && !departureRunway) || (body?.arrivalRunway != null && !arrivalRunway)
    || (cycle != null && !/^\d{4}$/.test(cycle)) || (entryFix != null && !/^[A-Z0-9]{2,5}$/.test(entryFix))
    || (selectedStar != null && !/^[A-Z]{2,6}\d{1,2}[A-Z]?$/.test(selectedStar))) {
    return json({ error: 'Valid origin, destination, filed route and optional runway/AIRAC/entry fix are required' }, 400);
  }
  try { return json(await getGeometry({ origin, destination, route, departureRunway, arrivalRunway, cycle, entryFix, selectedStar })); }
  catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 502); }
}
