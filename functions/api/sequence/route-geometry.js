const AIRAC_ORIGIN = 'https://airac.net';
const ROUTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const routeCache = new Map();

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, max-age=300' },
});

function cleanAirport(value) {
  const airport = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(airport) ? airport : null;
}

function cleanRoute(value) {
  const route = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!route || route.length > 2000) return null;
  return route;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = finiteNumber(value.coordinates?.lat ?? value.latitude);
  const lon = finiteNumber(value.coordinates?.lon ?? value.longitude);
  const identifier = String(value.identifier || '').trim().toUpperCase();
  if (!identifier || lat == null || lon == null) return null;
  return {
    identifier: identifier.slice(0, 20),
    type: value.type ? String(value.type).slice(0, 30) : null,
    coordinates: { lat, lon },
  };
}

function sanitizeGeometry(payload, origin, destination) {
  const data = payload?.data;
  if (!data || !Array.isArray(data.segments)) throw new Error('AIRAC route parser returned no route segments');

  const segments = [];
  for (const segment of data.segments) {
    const from = cleanPoint(segment?.from);
    const to = cleanPoint(segment?.to);
    const distance = finiteNumber(segment?.distance);
    const bearing = finiteNumber(segment?.bearing);
    const cumulativeDistance = finiteNumber(segment?.cumulative_distance);
    if (!from || !to || distance == null || cumulativeDistance == null) continue;
    segments.push({ from, to, distance, bearing, cumulativeDistance });
  }
  if (!segments.length) throw new Error('AIRAC route parser returned no usable route geometry');

  const errors = Array.isArray(data.errors)
    ? data.errors.slice(0, 20).map((error) => ({
        type: String(error?.type || 'route_warning').slice(0, 80),
        message: String(error?.message || '').slice(0, 240),
      }))
    : [];

  return {
    origin,
    destination,
    totalDistance: finiteNumber(data.total_distance),
    segments,
    errors,
  };
}

async function getRouteGeometry(origin, destination, route) {
  const key = `${origin}|${destination}|${route}`;
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const params = new URLSearchParams({ origin, destination, route });
  const response = await fetch(`${AIRAC_ORIGIN}/api/v1/routes/parse?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BangkokFIRArrivalSequencing/1.0 (+https://github.com/zporporz/arrival-sequencing)',
    },
    cf: { cacheTtl: 21600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`AIRAC route parser returned ${response.status}`);
  const payload = await response.json();
  if (payload?.status && payload.status !== 'success') throw new Error('AIRAC route parser could not resolve this route');

  const value = sanitizeGeometry(payload, origin, destination);
  routeCache.set(key, { expiresAt: Date.now() + ROUTE_CACHE_TTL_MS, value });
  if (routeCache.size > 300) {
    const firstKey = routeCache.keys().next().value;
    if (firstKey) routeCache.delete(firstKey);
  }
  return value;
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const origin = cleanAirport(body?.origin);
    const destination = cleanAirport(body?.destination);
    const route = cleanRoute(body?.route);
    if (!origin || !destination || !route) return json({ error: 'Origin, destination and filed route are required' }, 400);

    return json(await getRouteGeometry(origin, destination, route));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
