import legacy from '../_data/final-approaches.json' with { type: 'json' };
import regional from '../_data/regional-arrivals.json' with { type: 'json' };
import { supabaseAdminRequest } from './supabaseAdmin.js';

export const AIRAC_AIRPORT_CODES = ['VTBD', 'VTBS', 'VTCC', 'VTSP'];
const unavailable = message => Object.assign(new Error(message), { code: 'AIRAC_PACKAGE_UNAVAILABLE' });
const verifiedPackages = new WeakMap();
const point = p => p && typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
  && typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
export function validateAiracAirports(airports) {
  if (!airports || typeof airports !== 'object' || Array.isArray(airports)) throw new Error('Complete AIRAC airport package required. Select the SQLite file again.');
  if (JSON.stringify(airports).length > 8 * 1024 * 1024) throw new Error('AIRAC airport package exceeds size limit.');
  for (const code of AIRAC_AIRPORT_CODES) {
    const a = airports[code];
    if (!a || a.code !== code || !point(a) || !Number.isFinite(a.elevationFt)
      || !Array.isArray(a.runways) || !a.runways.length || a.runways.length > 12
      || !Array.isArray(a.procedures) || !a.procedures.length || a.procedures.length > 1000) throw new Error(`Incomplete AIRAC airport: ${code}`);
    const names = new Set();
    for (const r of a.runways) {
      if (!/^(?:0[1-9]|[12]\d|3[0-6])[LRC]?$/.test(r.name) || names.has(r.name) || !point(r)
        || !Number.isFinite(r.elevationFt) || !Number.isFinite(r.course) || r.course < 0 || r.course > 360
        || !Number.isFinite(r.displacedThresholdFt) || r.displacedThresholdFt < 0) throw new Error(`Invalid AIRAC runway: ${code}`);
      names.add(r.name);
    }
    for (const p of a.procedures) {
      if (!['STAR', 'APPROACH'].includes(p.kind) || !names.has(p.runway) || !p.name
        || !Array.isArray(p.legs) || !Array.isArray(p.transitions)) throw new Error(`Invalid AIRAC procedure: ${code}`);
      for (const path of [p.legs, ...p.transitions.map(t => t.legs)]) {
        if (!Array.isArray(path) || path.length > 500 || path.some(l => !l || typeof l.path !== 'string'
          || (l.lat != null || l.lon != null) && !point(l))) throw new Error(`Invalid AIRAC legs: ${code}`);
      }
    }
    for (const runway of names) {
      if (!a.procedures.some(p => p.runway === runway && p.kind === 'APPROACH' && p.legs.filter(point).length >= 2)) {
        throw new Error(`AIRAC Approach geometry missing: ${code} ${runway}`);
      }
      if (['VTCC', 'VTSP'].includes(code) && !a.procedures.some(p => p.runway === runway && p.kind === 'STAR' && p.legs.filter(point).length >= 2)) {
        throw new Error(`AIRAC STAR geometry missing: ${code} ${runway}`);
      }
    }
  }
  return airports;
}

export async function cycleAiracAirports(env, cycle) {
  if (cycle.cycle === legacy.cycle && cycle.source_sha256 === legacy.sourceSha256) {
    return { ...legacy.airports, ...regional.airports };
  }
  const key = `${cycle.id}:${cycle.cycle}:${cycle.source_sha256}`;
  const cache = verifiedPackages.get(env) || new Map();
  verifiedPackages.set(env, cache);
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.airports;
  // One immutable package record ties all airports to one cycle and source hash.
  // Existing navdata event JSON storage works on MariaDB and the test backend.
  const result = await supabaseAdminRequest(env, `navdata_events?cycle_id=eq.${encodeURIComponent(cycle.id)}&action=eq.AIRAC_PACKAGE&select=details&order=id.desc&limit=1`);
  const details = result.data?.[0]?.details;
  if (details) {
    if (details.sourceSha256 !== cycle.source_sha256 || details.cycle !== cycle.cycle) throw unavailable('AIRAC airport package source mismatch.');
    try {
      const airports = validateAiracAirports(details.airports);
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(key, { airports, until: Date.now() + 30_000 });
      return airports;
    }
    catch (error) { throw unavailable(error.message); }
  }
  // Preserve old installations only when the actual source file also matches.
  throw unavailable(`AIRAC ${cycle.cycle} has no STAR/Approach airport package. Staff must select the same SQLite file again to complete this AIRAC.`);
}

export async function activeAiracAirport(env, code) {
  if (!AIRAC_AIRPORT_CODES.includes(code)) throw new Error('Unsupported approach airport');
  const { data: cycles } = await supabaseAdminRequest(env, 'navdata_cycles?status=eq.ACTIVE&select=id,cycle,source_sha256&limit=1');
  const cycle = cycles?.[0];
  if (!cycle) throw unavailable('No active AIRAC.');
  const airports = await cycleAiracAirports(env, cycle);
  return { cycle: cycle.cycle, source: 'LITTLE_NAVMAP_NAVIGRAPH', airport: airports[code] };
}
