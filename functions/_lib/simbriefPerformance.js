const SIMBRIEF_AIRFRAMES_URL = 'https://www.simbrief.com/api/inputs.airframes.json';
const DATASET_TTL_MS = 6 * 60 * 60 * 1000;

let datasetCache = { expiresAt: 0, data: null, promise: null };
const profileCache = new Map();

function cleanType(value) {
  const type = String(value || '').trim().toUpperCase().split(/[\s/]/)[0];
  return /^[A-Z0-9]{2,8}$/.test(type) ? type : null;
}

function parseDescentProfile(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/^(\d{2,3})\/(\d{2,3})\/(\d{2,3})$/);
  if (!match) return null;

  const machToken = Number(match[1]);
  const descentIasKt = Number(match[2]);
  const below10000IasKt = Number(match[3]);
  const descentMach = machToken >= 10 ? machToken / 100 : machToken;

  if (!Number.isFinite(descentMach) || descentMach <= 0 || descentMach > 1.2) return null;
  if (!Number.isFinite(descentIasKt) || descentIasKt < 100 || descentIasKt > 450) return null;
  if (!Number.isFinite(below10000IasKt) || below10000IasKt < 100 || below10000IasKt > 350) return null;

  return {
    descentProfile: raw,
    descentMach,
    descentIasKt,
    descentBelow10000IasKt: below10000IasKt,
  };
}

async function fetchDataset() {
  if (datasetCache.data && Date.now() < datasetCache.expiresAt) return datasetCache.data;
  if (datasetCache.promise) return datasetCache.promise;

  datasetCache.promise = fetch(SIMBRIEF_AIRFRAMES_URL, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 21600, cacheEverything: true },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`SimBrief airframe endpoint returned ${response.status}`);
    const data = await response.json();
    datasetCache = {
      expiresAt: Date.now() + DATASET_TTL_MS,
      data,
      promise: null,
    };
    profileCache.clear();
    return data;
  }).catch((error) => {
    datasetCache.promise = null;
    throw error;
  });

  return datasetCache.promise;
}

function descentProfileFromEntry(entry) {
  const profiles = Array.isArray(entry?.aircraft_profiles_descent)
    ? entry.aircraft_profiles_descent
    : [];

  for (const profile of profiles) {
    const parsed = parseDescentProfile(profile);
    if (parsed) return parsed;
  }

  const airframes = Array.isArray(entry?.airframes) ? entry.airframes : [];
  const preferred = [
    ...airframes.filter((airframe) => String(airframe?.airframe_comments || '').trim().toLowerCase() === 'default'),
    ...airframes,
  ];
  for (const airframe of preferred) {
    const parsed = parseDescentProfile(airframe?.airframe_options?.defaultdescent);
    if (parsed) return parsed;
  }
  return null;
}

export async function getSimbriefAircraftPerformance(typeValue) {
  const type = cleanType(typeValue);
  if (!type) return null;
  if (profileCache.has(type)) return profileCache.get(type);

  const data = await fetchDataset();
  const entry = data && typeof data === 'object' ? data[type] : null;
  const parsed = descentProfileFromEntry(entry);
  const profile = parsed ? {
    source: 'SIMBRIEF',
    aircraftType: type,
    aircraftName: String(entry?.aircraft_name || '').trim() || null,
    aircraftDefaultCruise: String(entry?.aircraft_default_cruise || '').trim() || null,
    aircraftSpeed: String(entry?.aircraft_speed || '').trim() || null,
    ...parsed,
  } : null;

  profileCache.set(type, profile);
  return profile;
}

export function parseSimbriefDescentProfile(value) {
  return parseDescentProfile(value);
}
