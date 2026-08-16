const DEFAULT_SUPABASE_URL = "https://jamwzmqcerkivkgpezfh.supabase.co";

function cleanEnvSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^(["'])|(["'])$/g, "").trim();
}

function detectKeyKind(key) {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("eyJ")) return "legacy-jwt";
  return "unknown";
}

export function supabaseAdminConfig(env) {
  const url = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const secretKey = cleanEnvSecret(env.SUPABASE_SECRET_KEY);
  const legacyKey = cleanEnvSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const key = secretKey || legacyKey;
  const envName = secretKey ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY";
  if (!key) throw new Error("Missing Supabase admin key. Set SUPABASE_SECRET_KEY (recommended) or SUPABASE_SERVICE_ROLE_KEY in Cloudflare.");
  return { url: url.replace(/\/$/, ""), key, keyKind: detectKeyKind(key), envName };
}

export async function supabaseAdminRequest(env, path, options = {}) {
  const { url, key, keyKind, envName } = supabaseAdminConfig(env);

  if (keyKind === "publishable") {
    throw new Error(`${envName} contains a publishable key. Admin requires an sb_secret_... key or legacy service_role key.`);
  }

  const headers = new Headers(options.headers || {});
  headers.set("apikey", key);

  // New Supabase secret keys (sb_secret_...) are opaque API keys, not JWTs.
  // Send them only in `apikey`. Legacy service_role keys are JWTs and can
  // also be sent as Authorization Bearer tokens.
  if (keyKind === "legacy-jwt") {
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
      const kindLabel = keyKind === "secret" ? "sb_secret_..." : keyKind === "legacy-jwt" ? "legacy JWT" : "unrecognized format";
      throw new Error(`Invalid Supabase admin API key (${kindLabel}) from ${envName}. Copy an admin key from this project's Supabase Settings > API Keys.`);
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
