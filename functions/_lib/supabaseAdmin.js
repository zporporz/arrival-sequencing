const DEFAULT_SUPABASE_URL = "https://jamwzmqcerkivkgpezfh.supabase.co";

export function supabaseAdminConfig(env) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

export async function supabaseAdminRequest(env, path, options = {}) {
  const { url, key } = supabaseAdminConfig(env);
  const headers = new Headers(options.headers || {});
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (!headers.has("Content-Type") && options.body) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.details || text || `Supabase returned ${response.status}`;
    throw new Error(message);
  }
  return { data, response };
}

export function actorPatch(auth) {
  return {
    updated_by_vid: String(auth.vid),
    updated_by_name: auth.name || null,
  };
}

export function creatorPatch(auth) {
  return {
    created_by_vid: String(auth.vid),
    created_by_name: auth.name || null,
    ...actorPatch(auth),
  };
}
