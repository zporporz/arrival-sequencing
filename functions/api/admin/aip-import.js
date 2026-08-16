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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`CAAT returned ${response.status} for ${url}`);
  return response.text();
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

function sourceForRecord(issue, record) {
  const chartDate = record.effectiveFrom || issue.effectiveDate || 'unknown date';
  return `CAAT eAIP AIRAC ${issue.airac || issue.folder.replace('-AIRAC', '')}; ${record.chartReference}; chart date ${chartDate}`.slice(0, 300);
}

async function scanCaat(request) {
  const url = new URL(request.url);
  const requestedIssue = url.searchParams.get('issue') || null;
  const historyHtml = await fetchText(HISTORY_URL);
  const folder = detectIssueFolder(historyHtml, requestedIssue);
  const coverUrl = `${CAAT_ORIGIN}/${folder}/html/VT-cover-en-GB.html`;
  const genUrl = `${CAAT_ORIGIN}/${folder}/html/eAIP/VT-GEN-3.2-en-GB.html`;
  const [coverHtml, genHtml] = await Promise.all([fetchText(coverUrl), fetchText(genUrl)]);
  const coverText = normalizeAipText(coverHtml);
  const metadata = parseIssueMetadata(coverText);
  const issue = {
    folder,
    airac: metadata.airac,
    effectiveDate: metadata.effectiveDate || folder.slice(0, 10),
    publicationDate: metadata.publicationDate,
    sourceUrl: genUrl,
    coverUrl,
  };
  const records = parseStarText(genHtml, {
    sourceKind: 'CAAT_EAIP',
    sourceLabel: `CAAT eAIP AIRAC ${metadata.airac || folder}`,
    sourceUrl: genUrl,
  }).map((record) => ({ ...record, source: sourceForRecord(issue, record) }));

  if (!records.length) throw new Error('No STAR records were parsed from CAAT GEN 3.2');
  return { issue, records };
}

async function approveImport(env, auth, body) {
  const records = Array.isArray(body.records) ? body.records : [];
  if (!records.length) throw new Error('No STAR records selected for import');
  if (records.length > 500) throw new Error('Import is limited to 500 STAR records per approval');

  const existingResult = await supabaseAdminRequest(env, 'star_procedures?select=*');
  const existing = existingResult.data || [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const input of records) {
    const runwayConfigId = cleanText(input.runwayConfigId, 64);
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

    const match = existing
      .filter((item) => item.runway_config_id === runwayConfigId && item.designator === designator)
      .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')))[0];

    if (!match) {
      await supabaseAdminRequest(env, 'star_procedures?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ ...next, ...creatorPatch(auth) }]),
      });
      existing.push(next);
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

  return { created, updated, unchanged, total: records.length };
}

export async function onRequestGet(context) {
  try {
    const result = await scanCaat(context.request);
    return json(result);
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
