import { actorPatch, creatorPatch, supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';
import { normalizeAipText, parseIssueMetadata, parseStarText } from '../../_lib/aipStarParser.js';

const CAAT_ORIGIN = 'https://aip.caat.or.th';
const HISTORY_URL = `${CAAT_ORIGIN}/history-en-GB.html`;
const json = (body, status = 200) => Response.json(body, { status });

function cleanText(value, max = 300) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function fetchCaat(url, accept = 'text/html,application/xhtml+xml') {
  const response = await fetch(url, {
    headers: { Accept: accept },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`CAAT returned ${response.status} for ${url}`);
  return response;
}

async function fetchText(url) {
  return (await fetchCaat(url)).text();
}

function detectIssueFolder(historyHtml, requestedIssue) {
  if (requestedIssue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedIssue)) throw new Error('Issue must use YYYY-MM-DD');
    return `${requestedIssue}-AIRAC`;
  }

  const folders = [...historyHtml.matchAll(/(\d{4}-\d{2}-\d{2})-AIRAC/gi)]
    .map((match) => match[1])
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort();
  if (!folders.length) throw new Error('No CAAT AIRAC issue links were found');

  const today = new Date().toISOString().slice(0, 10);
  const effective = folders.filter((date) => date <= today);
  return `${(effective.at(-1) || folders.at(-1))}-AIRAC`;
}

function normalizeRunway(value) {
  return normalizeAipText(value)
    .toUpperCase()
    .replace(/^RWY\s*/i, '')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function runwayFlowFromApplicability(value) {
  const runways = normalizeRunway(value).match(/\b\d{2}[LRC]?\b/g) || [];
  const unique = [...new Set(runways)].sort();
  if (!unique.length) return null;
  return unique.join('_').slice(0, 32);
}

function sameRunwaySet(left, right) {
  return runwayFlowFromApplicability(left) === runwayFlowFromApplicability(right);
}

function sourceForRecord(issue, record) {
  const chartDate = record.effectiveFrom || issue.effectiveDate || 'unknown date';
  return `CAAT eAIP AIRAC ${issue.airac || issue.folder.replace('-AIRAC', '')}; ${record.chartReference}; chart date ${chartDate}`.slice(0, 300);
}

function extractWaypointTables(html, aerodromeUrl, airport) {
  const tables = [];
  const seen = new Set();
  for (const rowMatch of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    if (!/Standard\s+Arrival\s+Chart[\s\S]*?\(Waypoint\s+list\s+table\)/i.test(rowHtml)) continue;
    const text = normalizeAipText(rowHtml);
    const runwayMatch = text.match(/RNAV\s+RWY\s*([0-9]{2}[LRC]?(?:\s*\/\s*[0-9]{2}[LRC]?){0,3})/i);
    const chartMatch = text.match(/AD\s*2-(VT[A-Z0-9]{2})-7-(\d+)/i);
    const hrefMatch = rowHtml.match(/href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/i);
    if (!runwayMatch || !chartMatch || !hrefMatch) continue;

    const chartAirport = chartMatch[1].toUpperCase();
    if (chartAirport !== airport) continue;
    const assetUrl = new URL(hrefMatch[1].replace(/&amp;/gi, '&'), aerodromeUrl);
    if (assetUrl.origin !== CAAT_ORIGIN) continue;
    if (!/^\/\d{4}-\d{2}-\d{2}-AIRAC\/graphics\/[A-Za-z0-9._-]+\.pdf$/i.test(assetUrl.pathname)) continue;

    const runwayApplicability = normalizeRunway(runwayMatch[1]);
    const chartReference = `AD 2-${chartAirport}-7-${chartMatch[2]}`;
    const key = `${chartAirport}|${runwayApplicability}|${chartReference}|${assetUrl.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push({
      airport: chartAirport,
      runwayApplicability,
      chartReference,
      assetPath: assetUrl.pathname,
    });
  }
  return tables;
}

function extractTransitionWaypoints(html) {
  const fixes = new Set();
  const ignored = new Set(['INBOUND', 'ROUTES', 'ROUTE', 'TRANSITION', 'WAYPOINT', 'STAR', 'VTBS', 'RWY', 'NIL']);

  for (const tableMatch of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const tableHtml = tableMatch[0];
    const tableText = normalizeAipText(tableHtml).toUpperCase();
    if (!tableText.includes('INBOUND ROUTES') || !tableText.includes('TRANSITION WAYPOINT') || !tableText.includes('STAR')) continue;

    for (const rowMatch of tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
        .map((match) => normalizeAipText(match[1]).toUpperCase())
        .filter(Boolean);
      if (cells.length < 2) continue;
      const waypointCell = cells[1];
      if (waypointCell.includes('TRANSITION WAYPOINT')) continue;
      for (const token of waypointCell.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || []) {
        if (ignored.has(token)) continue;
        if (/^\d+$/.test(token)) continue;
        fixes.add(token);
      }
    }
  }

  return [...fixes].sort();
}

async function issueContext(request) {
  const url = new URL(request.url);
  const requestedIssue = url.searchParams.get('issue') || null;
  const historyHtml = await fetchText(HISTORY_URL);
  const folder = detectIssueFolder(historyHtml, requestedIssue);
  const coverUrl = `${CAAT_ORIGIN}/${folder}/html/VT-cover-en-GB.html`;
  const coverHtml = await fetchText(coverUrl);
  const metadata = parseIssueMetadata(normalizeAipText(coverHtml));
  return {
    folder,
    airac: metadata.airac,
    effectiveDate: metadata.effectiveDate || folder.slice(0, 10),
    publicationDate: metadata.publicationDate,
    coverUrl,
  };
}

async function scanCaat(request) {
  const issueBase = await issueContext(request);
  const genUrl = `${CAAT_ORIGIN}/${issueBase.folder}/html/eAIP/VT-GEN-3.2-en-GB.html`;
  const genHtml = await fetchText(genUrl);
  const issue = { ...issueBase, sourceUrl: genUrl };
  const records = parseStarText(genHtml, {
    sourceKind: 'CAAT_EAIP',
    sourceLabel: `CAAT eAIP AIRAC ${issueBase.airac || issueBase.folder}`,
    sourceUrl: genUrl,
  }).map((record) => ({ ...record, source: sourceForRecord(issue, record) }));

  if (!records.length) throw new Error('No STAR records were parsed from CAAT GEN 3.2');
  return { issue, records };
}

async function scanWaypointTables(env, request) {
  const url = new URL(request.url);
  const airport = cleanText(url.searchParams.get('airport'), 4)?.toUpperCase();
  if (!airport || !/^[A-Z]{4}$/.test(airport)) throw new Error('Airport ICAO is required');

  const airportResult = await supabaseAdminRequest(env, `airports?icao=eq.${encodeURIComponent(airport)}&select=icao&limit=1`);
  if (!airportResult.data?.length) throw new Error(`${airport} is not configured in Admin`);

  const issue = await issueContext(request);
  const aerodromeUrl = `${CAAT_ORIGIN}/${issue.folder}/html/eAIP/VT-AD-2.${airport}-en-GB.html`;
  const html = await fetchText(aerodromeUrl);
  const tables = extractWaypointTables(html, aerodromeUrl, airport);
  const transitionWaypoints = extractTransitionWaypoints(html);
  return { issue: { ...issue, sourceUrl: aerodromeUrl }, airport, tables, transitionWaypoints };
}

async function proxyAsset(request) {
  const url = new URL(request.url);
  const assetPath = url.searchParams.get('asset') || '';
  if (!/^\/\d{4}-\d{2}-\d{2}-AIRAC\/graphics\/[A-Za-z0-9._-]+\.pdf$/i.test(assetPath)) {
    return json({ error: 'Invalid CAAT asset path' }, 400);
  }
  const response = await fetchCaat(`${CAAT_ORIGIN}${assetPath}`, 'application/pdf');
  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('Content-Type') || 'application/pdf');
  headers.set('Cache-Control', 'private, max-age=900');
  headers.set('Content-Disposition', 'inline');
  return new Response(response.body, { status: 200, headers });
}

async function approveImport(env, auth, body) {
  const records = Array.isArray(body.records) ? body.records : [];
  if (!records.length) throw new Error('No STAR records selected for import');
  if (records.length > 500) throw new Error('Import is limited to 500 STAR records per approval');

  const [existingResult, airportsResult, runwaysResult] = await Promise.all([
    supabaseAdminRequest(env, 'star_procedures?select=*'),
    supabaseAdminRequest(env, 'airports?select=*'),
    supabaseAdminRequest(env, 'runway_configs?select=*'),
  ]);
  const existing = existingResult.data || [];
  const airports = airportsResult.data || [];
  const runways = runwaysResult.data || [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let draftAirportsCreated = 0;
  let draftRunwaysCreated = 0;

  const ensureDraftMapping = async (input) => {
    const airportCode = cleanText(input.airport, 4)?.toUpperCase();
    const runwayLabel = normalizeRunway(input.runwayApplicability);
    const flow = runwayFlowFromApplicability(runwayLabel);
    if (!airportCode || !/^VT[A-Z0-9]{2}$/.test(airportCode)) throw new Error('A valid Thailand airport ICAO is required for automatic mapping');
    if (!flow) throw new Error(`${airportCode}: CAAT runway applicability could not be resolved`);

    let airport = airports.find((item) => item.icao === airportCode);
    if (!airport) {
      const inserted = await supabaseAdminRequest(env, 'airports?on_conflict=icao&select=*', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify([{
          icao: airportCode,
          name: `${airportCode} · CAAT eAIP draft`,
          city: null,
          fir: 'BANGKOK',
          active: true,
          published: false,
          ...creatorPatch(auth),
        }]),
      });
      airport = inserted.data?.[0];
      if (!airport) {
        const reread = await supabaseAdminRequest(env, `airports?icao=eq.${encodeURIComponent(airportCode)}&select=*&limit=1`);
        airport = reread.data?.[0];
      } else {
        draftAirportsCreated += 1;
      }
      if (!airport) throw new Error(`${airportCode}: failed to create draft airport`);
      airports.push(airport);
    }

    let runway = runways.find((item) => item.airport_id === airport.id && sameRunwaySet(item.label || item.flow, runwayLabel));
    if (!runway) {
      const inserted = await supabaseAdminRequest(env, 'runway_configs?on_conflict=airport_id,flow&select=*', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify([{
          airport_id: airport.id,
          flow,
          label: runwayLabel,
          timing_status: 'PENDING',
          active: true,
          published: false,
          sort_order: 900,
          notes: 'Draft mapping created from reviewed CAAT eAIP STAR runway applicability; requires staff timing review before publication.',
          ...creatorPatch(auth),
        }]),
      });
      runway = inserted.data?.[0];
      if (!runway) {
        const reread = await supabaseAdminRequest(env, `runway_configs?airport_id=eq.${encodeURIComponent(airport.id)}&flow=eq.${encodeURIComponent(flow)}&select=*&limit=1`);
        runway = reread.data?.[0];
      } else {
        draftRunwaysCreated += 1;
      }
      if (!runway) throw new Error(`${airportCode} RWY ${runwayLabel}: failed to create draft runway flow`);
      runways.push(runway);
    }
    return runway.id;
  };

  for (const input of records) {
    let runwayConfigId = cleanText(input.runwayConfigId, 64);
    if (runwayConfigId) {
      const configuredRunway = runways.find((item) => item.id === runwayConfigId);
      const configuredAirport = airports.find((item) => item.id === configuredRunway?.airport_id);
      const inputAirport = cleanText(input.airport, 4)?.toUpperCase();
      if (!configuredRunway || !configuredAirport) throw new Error('Selected runway mapping no longer exists');
      if (inputAirport && configuredAirport.icao !== inputAirport) throw new Error(`${inputAirport}: selected runway mapping belongs to ${configuredAirport.icao}`);
    } else {
      runwayConfigId = await ensureDraftMapping(input);
    }
    const designator = cleanText(input.designator, 40)?.toUpperCase();
    const effectiveFrom = cleanText(input.effectiveFrom, 10);
    if (!runwayConfigId || !designator) throw new Error('Every imported STAR needs a runway configuration and designator');
    if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      throw new Error(`${designator}: effective date must be reviewed before import`);
    }

    const next = {
      runway_config_id: runwayConfigId,
      designator,
      entry_fix: cleanText(input.entryFix, 20)?.toUpperCase(),
      runway_applicability: cleanText(input.runwayApplicability, 120),
      chart_reference: cleanText(input.chartReference, 200),
      source: cleanText(input.source, 300),
      effective_from: effectiveFrom,
      effective_to: null,
      active: true,
    };

    const match = existing.find((item) => item.runway_config_id === runwayConfigId
      && item.designator === designator
      && String(item.effective_from || '') === effectiveFrom);

    if (!match) {
      await supabaseAdminRequest(env, 'star_procedures?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ ...next, ...creatorPatch(auth) }]),
      });
      existing.push({ ...next, id: null });
      created += 1;
      continue;
    }

    const comparable = ['entry_fix', 'runway_applicability', 'chart_reference', 'source', 'effective_from', 'effective_to', 'active'];
    const changed = comparable.some((field) => (match[field] ?? null) !== (next[field] ?? null));
    if (!changed) {
      unchanged += 1;
      continue;
    }

    await supabaseAdminRequest(env, `star_procedures?id=eq.${encodeURIComponent(match.id)}&select=*`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...next, ...actorPatch(auth) }),
    });
    Object.assign(match, next);
    updated += 1;
  }

  return { created, updated, unchanged, draftAirportsCreated, draftRunwaysCreated, total: records.length };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  try {
    if (url.searchParams.has('asset')) return proxyAsset(context.request);
    if (url.searchParams.get('mode') === 'waypoint-tables') {
      return json(await scanWaypointTables(context.env, context.request));
    }
    return json(await scanCaat(context.request));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    if (body.action !== 'approve') return json({ error: 'Unsupported action' }, 400);
    const result = await approveImport(context.env, context.data.auth, body);
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
