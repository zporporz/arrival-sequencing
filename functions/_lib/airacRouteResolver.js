import entryTransitions from '../../shared/arrivalEntryTransitions.json';
import { chooseArrivalStar, supportsArrivalRunway } from '../../shared/arrivalStarSelection.js';

const BASE = 'https://airac.net/api/v1';
const USER_AGENT = 'BangkokFIRArrivalSequencing/2.0 (+https://github.com/zporporz/arrival-sequencing)';
const code = (value) => String(value || '').trim().toUpperCase();
const tokenName = (token) => code(token).split('/')[0];
const procedureName = /^[A-Z]{2,6}\d{1,2}[A-Z]?$/;
const speedLevel = /^(?:[NMK]\d{3,4})?(?:[FAS]\d{3,4}|VFR)$/;

// A published feeder extension is an estimate, NOT a filed/cleared STAR. Only
// extend a known terminal fix; never drop later filed tokens to force a match.
export function arrivalEntryExtension(destination, route, entryFix) {
  const tokens = code(route).split(/\s+/);
  const meaningful = tokens.map(tokenName).filter((t) => t !== destination && t !== 'DCT' && !speedLevel.test(t));
  if (!entryFix || meaningful.includes(entryFix)) return null;
  const via = meaningful.at(-1);
  const path = entryTransitions.airports[destination]?.[via];
  if (!path || path.at(-1) !== entryFix) return null;
  // A destination token at the end is harmless; any other trailing instruction
  // is not. This includes unresolved STARs, unknown fixes and airways.
  while (tokens.at(-1) === destination || tokens.at(-1) === 'DCT') tokens.pop();
  if (tokenName(tokens.at(-1)) !== via) return null;
  return { route: [...tokens, 'DCT', ...path.flatMap((fix, i) => i ? ['DCT', fix] : [fix])].join(' '),
    via, path: [...path], source: entryTransitions.source };
}

export function normalizeRunway(value) {
  const runway = code(value).replace(/^RWY?/, '');
  const match = runway.match(/^(\d{1,2})([LRCB]?)$/);
  return match && Number(match[1]) >= 1 && Number(match[1]) <= 36
    ? `${match[1].padStart(2, '0')}${match[2]}` : null;
}

const list = (value) => Array.isArray(value) ? value : [];
const groupLegs = (value) => value && typeof value === 'object' ? Object.values(value).filter(Array.isArray) : [];
function endpointNames(detail, kind) {
  const groups = [list(detail.common_route), ...groupLegs(detail.transitions), ...groupLegs(detail.runway_transitions)];
  return groups.map((legs) => kind === 'SID' ? legs.at(-1)?.fix_identifier : legs[0]?.fix_identifier).map(code).filter(Boolean);
}

// Prefix resemblance only finds candidates; the published endpoint proves the
// alias. Never blindly truncate a filed name or change its revision/suffix.
function aliasMatches(filed, identifier, detail, kind) {
  const suffix = identifier.match(/\d{1,2}[A-Z]?$/)?.[0];
  if (!suffix) return false;
  const stem = identifier.slice(0, -suffix.length);
  return endpointNames(detail, kind).some((fix) => {
    if (!fix.startsWith(stem)) return false;
    return `${fix}${suffix}` === filed || (stem === fix && `${fix.slice(0, 6 - suffix.length)}${suffix}` === filed);
  });
}

function availableRunways(detail) {
  return [...new Set([...list(detail.available_runways), ...Object.keys(detail.runway_transitions || {})]
    .map(normalizeRunway).filter(Boolean))];
}
function supportsRunway(candidate, runway) {
  return supportsArrivalRunway(candidate, runway);
}
// Prefer the common-route entry; otherwise use the selected runway branch.
// Feeder transition starts are NOT interchangeable with the STAR entry itself.
function starEntries(detail, runway) {
  const common = list(detail.common_route);
  const groups = common.length ? [common] : Object.entries(detail.runway_transitions || {})
    .filter(([r]) => !runway || supportsRunway(normalizeRunway(r) || '', runway)).map(([, legs]) => list(legs));
  return [...new Set(groups.map(legs => point({ identifier: legs[0]?.fix_identifier,
    coordinates: legs[0]?.fix_coordinates })?.identifier).filter(Boolean))];
}

function publishedEntryExtension(detail, tokens, entryFix, cycle) {
  const meaningful = tokens.map(tokenName).filter(t => t !== 'DCT' && !speedLevel.test(t));
  const via = meaningful.at(-1);
  // Only a published, unambiguous feeder can fill a missing entry. Do not
  // truncate an unknown waypoint/airway or fabricate a direct from the aircraft.
  const paths = groupLegs(detail.transitions).flatMap(legs => {
    const end = legs.findIndex(l => code(l.fix_identifier) === entryFix);
    if (code(legs[0]?.fix_identifier) !== via || end < 1) return [];
    const path = legs.slice(0, end + 1);
    if (path.some((l, i) => !['IF', 'TF'].includes(l.path_terminator) || (i && l.path_terminator === 'IF')
      || !point({ identifier: l.fix_identifier, coordinates: l.fix_coordinates }))) return [];
    return [path.map(l => code(l.fix_identifier))];
  });
  const unique = [...new Map(paths.map(path => [path.join(' '), path])).values()];
  if (unique.length !== 1) return null;
  while (tokens.at(-1) === 'DCT') tokens.pop();
  const path = unique[0].slice(1);
  return { tokens: [...tokens, ...path.flatMap(fix => ['DCT', fix])], via, path,
    source: `AIRAC ${cycle} · published transition of filed ${detail.identifier}` };
}
function selectRunway(detail, requested) {
  const runways = availableRunways(detail);
  if (requested) {
    if (requested.endsWith('B')) throw new Error('A concrete runway is required, not a parallel runway family');
    if (runways.length && !runways.some((r) => supportsRunway(r, requested))) throw new Error(`Runway ${requested} is not supported by ${detail.identifier}`);
    return requested;
  }
  if (runways.length === 1 && !runways[0].endsWith('B')) return runways[0];
  if (runways.length) throw new Error(`Runway required for ${detail.identifier}; multiple/parallel runway choices`);
  return null;
}

function point(value) {
  const lat = value?.coordinates?.lat, lon = value?.coordinates?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !code(value.identifier)) return null;
  return { identifier: code(value.identifier).slice(0, 20), type: value.type ? String(value.type).slice(0, 30) : null, coordinates: { lat, lon } };
}
function samePosition(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6880.13 * Math.asin(Math.sqrt(Math.min(1, h))) <= .1;
}
function sanitize(payload, origin, destination) {
  const data = payload.data;
  if (!Array.isArray(data?.segments)) throw new Error('AIRAC returned no route segments');
  const segments = data.segments.map((s) => {
    const from = point(s?.from), to = point(s?.to);
    if (!from || !to || !Number.isFinite(s.distance) || s.distance < 0 || !Number.isFinite(s.cumulative_distance)) return null;
    return { from, to, distance: s.distance, bearing: Number.isFinite(s.bearing) ? s.bearing : null,
      cumulativeDistance: s.cumulative_distance, via: code(s.to?.via) || null };
  });
  const errors = list(data.errors).slice(0, 20).map((e) => ({ type: code(e?.type).toLowerCase() || 'route_warning',
    message: String(e?.message || '').slice(0, 240), segment: code(e?.segment).slice(0, 40) }));
  // Do not silently bridge malformed/missing geometry.
  if (segments.some((s) => !s)) errors.push({ type: 'invalid_geometry', message: 'Route contains invalid coordinates or distances' });
  if (segments.some((s, i) => i && s && segments[i - 1] && !samePosition(segments[i - 1].to.coordinates, s.from.coordinates))) {
    errors.push({ type: 'route_discontinuity', message: 'Route contains disconnected segments' });
  }
  return { origin, destination, totalDistance: Number.isFinite(data.total_distance) ? data.total_distance : null,
    segments: segments.filter(Boolean), errors };
}

/** All airports use the same cycle-scoped resolver. No per-flight/MARNI map. */
export function createAiracRouteResolver(fetcher = (...args) => fetch(...args)) {
  const cache = new Map(), inflight = new Map();
  async function cached(key, expiresAt, action) {
    const old = cache.get(key);
    if (old?.expiresAt > Date.now()) return old.value;
    if (inflight.has(key)) return inflight.get(key);
    const promise = action().then((value) => {
      if (cache.size >= 600) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expiresAt });
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }
  async function read(path, cycle) {
    return cached(`${cycle?.cycle || 'current'}:${path}`, Math.min(Date.now() + (cycle ? 3600_000 : 60_000), cycle?.expiresAt || Infinity), async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetcher(`${BASE}/${path}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: controller.signal, cf: { cacheTtl: 0 } });
        if (!response.ok) throw new Error(`AIRAC request failed (${response.status})`);
        const headerCycle = response.headers.get('X-AIRAC-Cycle');
        if (cycle && headerCycle && headerCycle !== cycle.cycle) throw new Error('AIRAC changed during route lookup; refresh required');
        const result = await response.json();
        if (result.status !== 'success') throw new Error('AIRAC lookup was unsuccessful');
        return result;
      } finally { clearTimeout(timer); }
    });
  }
  async function currentCycle(expected) {
    const { data } = await read('airac/current');
    const expiresAt = Date.parse(data?.expiration_date || '');
    if (!/^\d{4}$/.test(data?.cycle) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Current AIRAC could not be verified');
    if (expected && expected !== data.cycle) throw new Error(`AIRAC mismatch: route service ${data.cycle}, selected data ${expected}`);
    return { cycle: data.cycle, expiresAt };
  }
  async function catalog(airport, kind, cycle) {
    const rows = [];
    for (let page = 1; page <= 10; page++) {
      const result = await read(`procedures?${new URLSearchParams({ airport, type: kind, per_page: '100', page: String(page) })}`, cycle);
      if (!Array.isArray(result.data)) throw new Error('Invalid procedure catalog');
      rows.push(...result.data.filter((p) => code(p.airport) === airport && code(p.type?.code) === kind));
      if (result.pagination?.has_more === false || (!result.pagination && result.data.length < 100)) return rows;
    }
    throw new Error('Procedure catalog is incomplete; refusing an ambiguous lookup');
  }
  async function findProcedure(filed, airport, kind, cycle) {
    const rows = await catalog(airport, kind, cycle);
    const ids = [...new Set(rows.map((p) => code(p.identifier)))];
    const exact = ids.includes(filed);
    const suffix = filed.match(/\d{1,2}[A-Z]?$/)?.[0];
    const candidates = exact ? [filed] : ids.filter((id) => {
      const tail = id.match(/\d{1,2}[A-Z]?$/)?.[0];
      if (!suffix || tail !== suffix) return false;
      const a = filed.slice(0, -suffix.length), b = id.slice(0, -tail.length);
      return a.startsWith(b) || b.startsWith(a);
    });
    if (candidates.length > 12) throw new Error(`Ambiguous procedure name ${filed}`);
    const matches = (await Promise.all(candidates.map(async (id) => {
      const { data } = await read(`procedures/${airport}/${encodeURIComponent(id)}`, cycle);
      if (code(data?.airport) !== airport || code(data?.identifier) !== id || code(data?.type?.code) !== kind) throw new Error('Procedure detail does not match its catalog');
      return exact || aliasMatches(filed, id, data, kind) ? data : null;
    }))).filter(Boolean);
    if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous procedure name ${filed}` : `Procedure ${filed} not verified at ${airport}`);
    return matches[0];
  }
  async function arrivalChoices(airport, runway, entryFix, cycle) {
    return cached(`star-choices:${cycle.cycle}:${airport}:${runway}:${entryFix}`, Math.min(Date.now() + 3600_000, cycle.expiresAt), async () => {
      const ids = [...new Set((await catalog(airport, 'STAR', cycle)).map(p => code(p.identifier)))];
      if (ids.length > 100) throw new Error('STAR catalog too large for a verified planning choice');
      const choices = []; let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length) {
          const id = ids[next++];
          const { data } = await read(`procedures/${airport}/${encodeURIComponent(id)}`, cycle);
          if (code(data?.airport) !== airport || code(data?.identifier) !== id || code(data?.type?.code) !== 'STAR') throw new Error('STAR catalog/detail mismatch');
          const entries = starEntries(data, runway);
          if (entries.length === 1 && entries[0] === entryFix) choices.push({ name: id, airport, entryFix, runways: availableRunways(data) });
        }
      }));
      return choices;
    });
  }
  async function parse(origin, destination, route, departureRunway, arrivalRunway, cycle) {
    // AIRAC's parser joins consecutive fixes directly, but treats the ICAO DCT
    // separator as a waypoint. Remove ONLY that standalone separator for the
    // upstream request; preserve every fix, airway, procedure and the filed text.
    const routeTokens = route.split(/\s+/);
    const parserRoute = routeTokens.filter((token) => token !== 'DCT').join(' ');
    const params = new URLSearchParams({ origin, destination, route: parserRoute });
    if (departureRunway) params.set('departure_runway', departureRunway);
    if (arrivalRunway) params.set('arrival_runway', arrivalRunway);
    const geometry = sanitize(await read(`routes/parse?${params}`, cycle), origin, destination);
    // Also prove explicit direct fix pairs survived the conversion. In particular
    // an inferred multi-fix feeder must not silently skip its intermediate fixes.
    routeTokens.forEach((token, i) => {
      if (token !== 'DCT') return;
      const from = i ? tokenName(routeTokens[i - 1]) : origin;
      const to = tokenName(routeTokens[i + 1]);
      if (/^[A-Z]{2,5}$/.test(from) && /^[A-Z]{2,5}$/.test(to)
        && from !== to && !geometry.segments.some(s => s.from.identifier === from && s.to.identifier === to)) {
        geometry.errors.push({ type: 'direct_leg_missing', segment: `${from} DCT ${to}`,
          message: `Direct leg ${from} to ${to} could not be verified` });
      }
    });
    return geometry;
  }

  return async function getGeometry({ origin, destination, route, departureRunway, arrivalRunway, cycle: expectedCycle, entryFix, selectedStar }) {
    const cycle = await currentCycle(expectedCycle);
    const extension = arrivalEntryExtension(destination, route, entryFix);
    const tokens = (extension?.route || route).split(/\s+/), names = tokens.map(tokenName);
    const meaningful = names.map((name, i) => ({ name, i })).filter(({ name }) => name !== origin && name !== destination && name !== 'DCT' && !speedLevel.test(name));
    const first = meaningful[0], last = meaningful.at(-1);
    const sid = first && procedureName.test(first.name) ? first : null;
    const star = last && procedureName.test(last.name) ? last : null;
    const diagnostics = [], procedures = [];
    const resolutions = await Promise.all([{ token: sid, airport: origin, kind: 'SID', runway: departureRunway },
      { token: star, airport: destination, kind: 'STAR', runway: arrivalRunway }].map(async ({ token, airport, kind, runway }) => {
      if (!token) return null;
      let detail;
      try {
        detail = await findProcedure(token.name, airport, kind, cycle);
        const resolved = { filed: token.name, identifier: detail.identifier, kind, airport, runway: selectRunway(detail, runway) };
        return { token, resolved, detail, kind };
      } catch (error) { return { token, detail, kind, error: { type: 'procedure_resolution', segment: token.name, scope: kind === 'SID' ? 'departure' : 'arrival', message: String(error.message || error) } }; }
    }));
    const single = sid && star && sid.i === star.i;
    const successes = resolutions.filter((r) => r?.resolved);
    for (const result of resolutions.filter(Boolean)) {
      if (single && successes.length !== 1) continue;
      if (result.resolved) {
        const { token, resolved } = result;
        tokens[token.i] = resolved.identifier + tokens[token.i].slice(token.name.length);
        procedures.push(resolved);
      } else if (!single) diagnostics.push(result.error);
    }
    if (single && successes.length !== 1) diagnostics.push({ type: 'procedure_resolution', segment: sid.name,
      message: successes.length ? `Ambiguous departure/arrival procedure ${sid.name}` : `Procedure ${sid.name} could not be verified` });
    const dep = procedures.find((p) => p.kind === 'SID')?.runway || departureRunway || null;
    const arr = procedures.find((p) => p.kind === 'STAR')?.runway || arrivalRunway || null;
    const normalizedRoute = tokens.join(' ');
    const filedStar = resolutions.find(r => r?.kind === 'STAR' && r.detail);
    const runwayMismatch = filedStar && arrivalRunway && !arrivalRunway.endsWith('B')
      && availableRunways(filedStar.detail).length && !availableRunways(filedStar.detail).some(r => supportsRunway(r, arrivalRunway));
    let arrivalSelection = null, recovered = null;
    if (runwayMismatch && entryFix) {
      const entries = starEntries(filedStar.detail);
      let candidates = [], lookupError = null;
      try {
        if (entries.length !== 1 || entries[0] !== entryFix) throw new Error('Filed STAR entry is ambiguous or differs from the requested entry');
        candidates = await arrivalChoices(destination, arrivalRunway, entryFix, cycle);
      }
      catch (error) { lookupError = String(error.message || error); }
      arrivalSelection = chooseArrivalStar({ airport: destination, runway: arrivalRunway, entryFix,
        filed: filedStar.token.name, candidates, selected: selectedStar, cycle: cycle.cycle });
      if (lookupError) arrivalSelection.reason += ` · Catalog unavailable: ${lookupError}`;
      // Recover only the filed procedure's published feeder up to the same entry.
      // Never parse the wrong-runway STAR as if it were active, even for one match.
      if (!names.includes(entryFix) && entries.length === 1 && entries[0] === entryFix) {
        const prefix = tokens.slice(0, filedStar.token.i);
        recovered = publishedEntryExtension(filedStar.detail, [...prefix], entryFix, cycle.cycle);
        // "... Y26 MARNI2A" already specifies the airway ending at the verified
        // procedure entry. Expand that endpoint, not an invented DCT; the full
        // airway section must still pass the independent parser below.
        if (!recovered && /^[A-Z]{1,2}\d{1,4}$/.test(tokenName(prefix.at(-1)))) {
          recovered = { tokens: [...prefix, entryFix], via: tokenName(prefix.at(-1)), path: [entryFix],
            source: `AIRAC ${cycle.cycle} · entry of filed ${filedStar.detail.identifier}` };
        }
      }
    }
    // Never let the upstream parser pick a default for an ambiguous procedure.
    let geometry = { origin, destination, totalDistance: null, segments: [], errors: diagnostics };
    if (!diagnostics.length) geometry = await parse(origin, destination, normalizedRoute, dep, arr, cycle);
    let entryRoute = null, entryRouteError = null;
    if (entryFix && !geometry.errors.length && !geometry.segments.some((s) => s.to.identifier === entryFix)) {
      geometry.errors.push({ type: 'entry_not_on_route', segment: entryFix,
        message: `No verified route to ${entryFix}; arrival entry/route confirmation required` });
    }
    if (entryFix && (diagnostics.length || geometry.errors.length)) {
      // Independently resolve the enroute section, including only an explicitly
      // labelled published feeder extension when present. Never drop a missing
      // airway/waypoint or assume the geometry of an unresolved SID/STAR.
      const entryTokens = recovered?.tokens || tokens, entryNames = entryTokens.map(tokenName);
      const endIndices = entryNames.flatMap((name, i) => name === entryFix ? [i] : []);
      const start = sid ? sid.i + 1 : first?.i;
      const end = endIndices.length === 1 ? endIndices[0] : -1;
      if (start != null && end > start && (recovered || !star || end < star.i)) {
        const section = entryTokens.slice(start, end + 1);
        while (section[0] === 'DCT') section.shift();
        const startFix = tokenName(section[0]);
        if (/^[A-Z]{2,5}$/.test(startFix) && startFix !== 'DCT') {
          try {
            const partial = await parse(origin, destination, section.join(' '), null, null, cycle);
            if (partial.errors.length) throw new Error('Filed enroute section contains unresolved waypoints/airways');
            const starts = partial.segments.flatMap((s, i) => s.from.identifier === startFix ? [i] : []);
            const ends = partial.segments.flatMap((s, i) => s.to.identifier === entryFix ? [i] : []);
            if (starts.length !== 1 || ends.length !== 1) throw new Error('Ambiguous filed enroute section endpoints');
            const fromIndex = starts[0], toIndex = ends[0];
            if (fromIndex < 0 || toIndex < fromIndex) throw new Error('Filed enroute section does not connect to the STAR entry');
            entryRoute = { ...partial, segments: partial.segments.slice(fromIndex, toIndex + 1), entryFix, cycle: cycle.cycle };
          } catch (error) { entryRouteError = String(error.message || error); }
        }
      }
      if (!entryRoute && !entryRouteError) entryRouteError = 'No verified filed enroute section to the STAR entry';
    }
    if (!geometry.segments.length && !entryRoute && !arrivalSelection) throw new Error(diagnostics.map((e) => e.message).join('; ') || 'No usable route geometry');
    return { ...geometry, cycle: cycle.cycle, normalizedRoute, departureRunway: dep, arrivalRunway: arr,
      arrivalSelection,
      entryRouteSource: recovered ? 'FILED_STAR_TRANSITION' : extension ? 'AIP_INFERRED' : 'FILED',
      entryTransition: recovered ? { via: recovered.via, path: recovered.path, source: recovered.source }
        : extension ? { via: extension.via, path: extension.path, source: extension.source } : null,
      procedures: procedures.sort((a, b) => a.kind.localeCompare(b.kind)), entryRoute, entryRouteError };
  };
}
