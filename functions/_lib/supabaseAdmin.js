const DEFAULT_SUPABASE_URL = "https://jamwzmqcerkivkgpezfh.supabase.co";

export function supabaseAdminConfig(env) {
  const url = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

export async function supabaseAdminRequest(env, path, options = {}) {
  const { url, key } = supabaseAdminConfig(env);
  const headers = new Headers(options.headers || {});
  headers.set("apikey", key);

  // New Supabase secret keys (sb_secret_...) are opaque API keys, not JWTs.
  // Send them only in `apikey`. Legacy service_role keys are JWTs and can
  // also be sent as Authorization Bearer tokens.
  if (!key.startsWith("sb_secret_")) {
    headers.set("Authorization", `Bearer ${key}`);
  } else {
    headers.delete("Authorization");
  }

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
    if (response.status === 401 && /invalid api key/i.test(String(message))) {
      throw new Error("Invalid Supabase admin API key. Check SUPABASE_SERVICE_ROLE_KEY in Cloudflare and make sure it belongs to this Supabase project.");
    }
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
