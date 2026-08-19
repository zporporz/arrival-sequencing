const SIMBRIEF_AIRFRAMES_URL = 'https://www.simbrief.com/api/inputs.airframes.json';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function cleanType(value) {
  const type = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(type) ? type : null;
}

function performanceFields(value, path = '', output = {}, depth = 0) {
  if (depth > 4 || value == null) return output;

  if (Array.isArray(value)) {
    value.slice(0, 25).forEach((item, index) => performanceFields(item, `${path}[${index}]`, output, depth + 1));
    return output;
  }

  if (typeof value !== 'object') return output;

  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (/(desc|climb|cruise|speed|mach|ias|tas|profile)/i.test(key)) {
      output[nextPath] = child;
    }
    if (child && typeof child === 'object') {
      performanceFields(child, nextPath, output, depth + 1);
    }
  }
  return output;
}

function normalizeAirframes(entry) {
  const airframes = Array.isArray(entry?.airframes) ? entry.airframes : [];
  return airframes.map((airframe) => ({
    internalId: airframe?.airframe_internal_id ?? null,
    listType: airframe?.airframe_list_type ?? null,
    comments: airframe?.airframe_comments ?? null,
    keys: airframe && typeof airframe === 'object' ? Object.keys(airframe).sort() : [],
    performanceFields: performanceFields(airframe),
    raw: airframe,
  }));
}

function findEntry(data, type) {
  if (!data || typeof data !== 'object') return null;
  if (data[type]) return { sourceKey: type, entry: data[type] };

  for (const [key, entry] of Object.entries(data)) {
    const airframes = Array.isArray(entry?.airframes) ? entry.airframes : [];
    if (airframes.some((airframe) => String(airframe?.airframe_list_type || '').trim().toUpperCase() === type)) {
      return { sourceKey: key, entry };
    }
  }
  return null;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const type = cleanType(url.searchParams.get('type') || 'A320');
    if (!type) return json({ error: 'Valid aircraft type is required' }, 400);

    const response = await fetch(SIMBRIEF_AIRFRAMES_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });

    if (!response.ok) {
      return json({
        error: `SimBrief airframe endpoint returned ${response.status}`,
        upstreamStatus: response.status,
      }, 502);
    }

    const data = await response.json();
    const match = findEntry(data, type);
    if (!match) {
      return json({
        type,
        found: false,
        topLevelKeysSample: Object.keys(data || {}).slice(0, 30),
      }, 404);
    }

    const airframes = normalizeAirframes(match.entry);
    const defaultAirframe = airframes.find((airframe) =>
      String(airframe.internalId || '').trim().toUpperCase() === type
      || String(airframe.comments || '').trim().toUpperCase() === 'DEFAULT'
    ) || null;

    return json({
      type,
      found: true,
      sourceKey: match.sourceKey,
      entryKeys: match.entry && typeof match.entry === 'object' ? Object.keys(match.entry).sort() : [],
      entryPerformanceFields: performanceFields(match.entry),
      airframeCount: airframes.length,
      defaultAirframe,
      airframes,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
