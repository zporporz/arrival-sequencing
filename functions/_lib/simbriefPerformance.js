import { supabaseAdminRequest } from './supabaseAdmin.js';

const SIMBRIEF_AIRFRAMES_URL = 'https://www.simbrief.com/api/inputs.airframes.json';
const DATASET_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_RECHECK_MS = 24 * 60 * 60 * 1000;

let datasetCache = { expiresAt: 0, data: null, promise: null };
const profileCache = new Map();

function cleanType(value) {
  const type = String(value || '').trim().toUpperCase().split(/[\s/]/)[0];
  return /^[A-Z0-9]{2,8}$/.test(type) ? type : null;
}

function normalizePerformanceCategory(value) {
  const category = String(value || '').trim().toUpperCase();
  return ['A', 'B', 'C', 'D', 'E', 'H'].includes(category) ? category : null;
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
  return { descentProfile: raw, descentMach, descentIasKt, descentBelow10000IasKt: below10000IasKt };
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
    datasetCache = { expiresAt: Date.now() + DATASET_TTL_MS, data, promise: null };
    return data;
  }).catch((error) => {
    datasetCache.promise = null;
    throw error;
  });
  return datasetCache.promise;
}

function preferredAirframes(entry) {
  const airframes = Array.isArray(entry?.airframes) ? entry.airframes : [];
  return [
    ...airframes.filter((airframe) => String(airframe?.airframe_comments || '').trim().toLowerCase() === 'default'),
    ...airframes,
  ];
}

function descentProfileFromEntry(entry) {
  const profiles = Array.isArray(entry?.aircraft_profiles_descent) ? entry.aircraft_profiles_descent : [];
  for (const profile of profiles) {
    const parsed = parseDescentProfile(profile);
    if (parsed) return parsed;
  }
  for (const airframe of preferredAirframes(entry)) {
    const parsed = parseDescentProfile(airframe?.airframe_options?.defaultdescent);
    if (parsed) return parsed;
  }
  return null;
}

function performanceCategoryFromEntry(entry) {
  const direct = [
    entry?.performance_category,
    entry?.aircraft_performance_category,
    entry?.per,
  ];
  for (const value of direct) {
    const category = normalizePerformanceCategory(value);
    if (category) return category;
  }
  for (const airframe of preferredAirframes(entry)) {
    const candidates = [
      airframe?.airframe_options?.per,
      airframe?.performance_category,
      airframe?.per,
    ];
    for (const value of candidates) {
      const category = normalizePerformanceCategory(value);
      if (category) return category;
    }
  }
  return null;
}

function dbRowToProfile(row) {
  if (!row) return null;
  return {
    source: 'SIMBRIEF',
    aircraftType: row.aircraft_type,
    aircraftName: row.aircraft_name || null,
    aircraftDefaultCruise: row.aircraft_default_cruise || null,
    aircraftSpeed: row.aircraft_speed || null,
    performanceCategory: normalizePerformanceCategory(row.performance_category),
    descentProfile: row.descent_profile,
    descentMach: row.descent_mach == null ? null : Number(row.descent_mach),
    descentIasKt: Number(row.descent_ias_kt),
    descentBelow10000IasKt: Number(row.descent_below_10000_ias_kt),
  };
}

async function readStoredProfile(env, type) {
  const result = await supabaseAdminRequest(
    env,
    `aircraft_performance_profiles?select=*&aircraft_type=eq.${encodeURIComponent(type)}&limit=1`,
  );
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function upsertStoredProfile(env, type, profile, sourceUpdatedAt) {
  const now = new Date().toISOString();
  const row = {
    aircraft_type: type,
    aircraft_name: profile.aircraftName,
    source: 'SIMBRIEF',
    performance_category: profile.performanceCategory,
    descent_profile: profile.descentProfile,
    descent_mach: profile.descentMach,
    descent_ias_kt: profile.descentIasKt,
    descent_below_10000_ias_kt: profile.descentBelow10000IasKt,
    aircraft_default_cruise: profile.aircraftDefaultCruise,
    aircraft_speed: profile.aircraftSpeed,
    source_updated_at: sourceUpdatedAt,
    last_checked_at: now,
  };
  const result = await supabaseAdminRequest(
    env,
    'aircraft_performance_profiles?on_conflict=aircraft_type&select=*',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([row]),
    },
  );
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

function sourceUpdatedAt(entry) {
  const candidates = [entry?.stats_updated, ...(Array.isArray(entry?.airframes) ? entry.airframes.map((x) => x?.modified_time) : [])]
    .map((value) => new Date(value || '').getTime())
    .filter(Number.isFinite);
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

function upstreamProfile(type, entry) {
  const parsed = descentProfileFromEntry(entry);
  if (!parsed) return null;
  return {
    source: 'SIMBRIEF',
    aircraftType: type,
    aircraftName: String(entry?.aircraft_name || '').trim() || null,
    aircraftDefaultCruise: String(entry?.aircraft_default_cruise || '').trim() || null,
    aircraftSpeed: String(entry?.aircraft_speed || '').trim() || null,
    performanceCategory: performanceCategoryFromEntry(entry),
    ...parsed,
  };
}

export async function getSimbriefAircraftPerformance(env, typeValue) {
  const type = cleanType(typeValue);
  if (!type) return null;
  const memory = profileCache.get(type);
  if (memory && Date.now() < memory.expiresAt) return memory.profile;

  let stored = null;
  try { stored = await readStoredProfile(env, type); } catch { stored = null; }
  const storedProfile = dbRowToProfile(stored);
  const lastCheckedMs = new Date(stored?.last_checked_at || '').getTime();
  const fresh = storedProfile && Number.isFinite(lastCheckedMs) && Date.now() - lastCheckedMs < PROFILE_RECHECK_MS;
  if (fresh) {
    profileCache.set(type, { expiresAt: Date.now() + 10 * 60 * 1000, profile: storedProfile });
    return storedProfile;
  }

  try {
    const data = await fetchDataset();
    const entry = data && typeof data === 'object' ? data[type] : null;
    const profile = upstreamProfile(type, entry);
    if (!profile) return storedProfile;
    const written = await upsertStoredProfile(env, type, profile, sourceUpdatedAt(entry));
    const resolved = dbRowToProfile(written) || profile;
    profileCache.set(type, { expiresAt: Date.now() + 10 * 60 * 1000, profile: resolved });
    return resolved;
  } catch {
    if (storedProfile) return storedProfile;
    throw new Error(`No stored or live SimBrief performance profile for ${type}`);
  }
}

export function parseSimbriefDescentProfile(value) {
  return parseDescentProfile(value);
}
