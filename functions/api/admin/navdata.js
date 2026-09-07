import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';
import { diffNavdataProcedures } from '../../_lib/navdataDiff.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function cleanText(value, max = 200) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function readCycles(env) {
  const [cycles, events] = await Promise.all([
    supabaseAdminRequest(env, 'navdata_cycles?select=*&order=imported_at.desc&limit=20'),
    supabaseAdminRequest(env, 'navdata_events?select=*&order=created_at.desc&limit=50'),
  ]);
  return { cycles: cycles.data || [], events: events.data || [] };
}

async function readAll(env, path, pageSize = 1000) {
  const result = [];
  for (let start = 0; ; start += pageSize) {
    const page = await supabaseAdminRequest(env, path, {
      headers: { Range: `${start}-${start + pageSize - 1}`, 'Range-Unit': 'items' },
    });
    const rows = Array.isArray(page.data) ? page.data : [];
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

async function readNavdataCycle(env, cycleId) {
  const encoded = encodeURIComponent(cycleId);
  const [procedures, transitions, legs] = await Promise.all([
    readAll(env, `navdata_procedures?cycle_id=eq.${encoded}&select=*&order=airport.asc,designator.asc,runway_name.asc`),
    readAll(env, `navdata_transitions?cycle_id=eq.${encoded}&select=*&order=procedure_id.asc,ident.asc`),
    readAll(env, `navdata_procedure_legs?cycle_id=eq.${encoded}&select=*&order=procedure_id.asc,transition_id.asc.nullsfirst,leg_order.asc`),
  ]);
  return { procedures, transitions, legs };
}

async function readCycleDetail(env, cycleId) {
  const encoded = encodeURIComponent(cycleId);
  const [cycle, targetData] = await Promise.all([
    supabaseAdminRequest(env, `navdata_cycles?id=eq.${encoded}&select=*&limit=1`),
    readNavdataCycle(env, cycleId),
  ]);
  const target = cycle.data?.[0];
  if (!target) throw new Error('Navdata cycle not found');

  let activeData = { procedures: [], transitions: [], legs: [] };
  const active = await supabaseAdminRequest(env, 'navdata_cycles?status=eq.ACTIVE&select=id&limit=1');
  const activeId = active.data?.[0]?.id;
  if (activeId && activeId !== cycleId) {
    activeData = await readNavdataCycle(env, activeId);
  }

  const comparison = diffNavdataProcedures(targetData, activeData);

  return {
    cycle: target,
    procedures: comparison.procedures,
    transitions: targetData.transitions,
    legs: targetData.legs,
    diff: { ...comparison.diff, comparedToActive: Boolean(activeId && activeId !== cycleId) },
  };
}

async function importCycle(env, auth, payload) {
  const meta = payload.meta || {};
  const procedures = Array.isArray(payload.procedures) ? payload.procedures : [];
  const transitions = Array.isArray(payload.transitions) ? payload.transitions : [];
  const legs = Array.isArray(payload.legs) ? payload.legs : [];
  if (!procedures.length) throw new Error('No STAR procedures were extracted from the SQLite database');
  const rpc = await supabaseAdminRequest(env, 'rpc/import_navdata_cycle', {
    method: 'POST',
    body: JSON.stringify({
      p_meta: meta,
      p_procedures: procedures,
      p_transitions: transitions,
      p_legs: legs,
      p_vid: String(auth.vid),
      p_name: auth.name || null,
    }),
  });
  return { id: rpc.data };
}

async function activateCycle(env, auth, cycleId) {
  if (!cycleId) throw new Error('Cycle id is required');
  await supabaseAdminRequest(env, 'rpc/activate_navdata_cycle', {
    method: 'POST',
    body: JSON.stringify({ p_cycle_id: cycleId, p_vid: String(auth.vid), p_name: auth.name || null }),
  });
  return { id: cycleId };
}

async function deleteCycle(env, auth, cycleId) {
  if (!cycleId) throw new Error('Cycle id is required');
  const current = await supabaseAdminRequest(env, `navdata_cycles?id=eq.${encodeURIComponent(cycleId)}&select=id,cycle,status&limit=1`);
  const target = current.data?.[0];
  if (!target) throw new Error('Cycle not found');
  if (target.status === 'ACTIVE') throw new Error('Active AIRAC cannot be deleted');
  await supabaseAdminRequest(env, `navdata_events?cycle_id=eq.${encodeURIComponent(cycleId)}`, { method: 'DELETE' });
  await supabaseAdminRequest(env, `navdata_cycles?id=eq.${encodeURIComponent(cycleId)}`, { method: 'DELETE' });
  return { id: cycleId, cycle: target.cycle, deletedBy: String(auth.vid) };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const cycleId = cleanText(url.searchParams.get('cycle'), 64);
    return json(cycleId ? await readCycleDetail(context.env, cycleId) : await readCycles(context.env));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const action = cleanText(payload.action, 40);
    let result;
    if (action === 'import') result = await importCycle(context.env, context.data.auth, payload);
    else if (action === 'activate') result = await activateCycle(context.env, context.data.auth, cleanText(payload.cycleId, 64));
    else if (action === 'delete') result = await deleteCycle(context.env, context.data.auth, cleanText(payload.cycleId, 64));
    else return json({ error: 'Unsupported navdata admin action' }, 400);
    return json({ ok: true, data: result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
