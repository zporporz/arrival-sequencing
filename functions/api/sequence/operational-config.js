import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export function isEffective(row, serviceDate) {
  return row.active === true
    && String(row.effective_from || '') <= serviceDate
    && (!row.effective_to || String(row.effective_to) >= serviceDate);
}

export function newestEffectiveTimings(rows, serviceDate) {
  const selected = new Map();
  for (const row of rows.filter((item) => isEffective(item, serviceDate))) {
    const key = `${String(row.airport).toUpperCase()}:${String(row.flow).toUpperCase()}:${String(row.fix).toUpperCase()}`;
    const current = selected.get(key);
    if (!current || String(row.effective_from) > String(current.effective_from)) selected.set(key, row);
  }
  return [...selected.values()];
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const requestedDate = url.searchParams.get('serviceDate');
    const serviceDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : new Date().toISOString().slice(0, 10);

    const [airportsResult, runwaysResult, timingsResult] = await Promise.all([
      supabaseAdminRequest(context.env, 'airports?select=id,icao,name,active,published&active=eq.true&published=eq.true&order=icao.asc'),
      supabaseAdminRequest(context.env, 'runway_configs?select=id,airport_id,flow,label,timing_status,active,published,sort_order,updated_at&active=eq.true&published=eq.true&timing_status=eq.ACTIVE&order=sort_order.asc,flow.asc'),
      supabaseAdminRequest(context.env, 'fix_timings?select=id,runway_config_id,airport,flow,fix,nominal_seconds,source,verified,effective_from,effective_to,active,updated_at&active=eq.true&order=effective_from.desc'),
    ]);

    const airports = airportsResult.data || [];
    const airportById = new Map(airports.map((airport) => [airport.id, airport]));
    const runways = (runwaysResult.data || []).filter((runway) => airportById.has(runway.airport_id));
    const runwayById = new Map(runways.map((runway) => [runway.id, runway]));
    const timings = newestEffectiveTimings(timingsResult.data || [], serviceDate)
      .filter((timing) => runwayById.has(timing.runway_config_id))
      .map((timing) => ({
        airport: String(timing.airport).toUpperCase(),
        flow: String(timing.flow).toUpperCase(),
        fix: String(timing.fix).toUpperCase(),
        nominalSeconds: Number(timing.nominal_seconds),
        source: timing.source,
        verified: Boolean(timing.verified),
        effectiveFrom: timing.effective_from,
        effectiveTo: timing.effective_to,
        updatedAt: timing.updated_at,
      }))
      .filter((timing) => Number.isFinite(timing.nominalSeconds) && timing.nominalSeconds > 0);

    const workspaces = runways.map((runway) => {
      const airport = airportById.get(runway.airport_id);
      return {
        airport: String(airport.icao).toUpperCase(),
        airportName: airport.name,
        flow: String(runway.flow).toUpperCase(),
        label: runway.label,
        timings: timings.filter((timing) => timing.airport === String(airport.icao).toUpperCase() && timing.flow === String(runway.flow).toUpperCase()),
      };
    });

    return json({ serviceDate, generatedAt: new Date().toISOString(), workspaces });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
