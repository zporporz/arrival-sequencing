export const STAFF_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const MEMBER_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const SESSION_IDLE_TIMEOUT_SECONDS = 2 * 60 * 60;
const CLOCK_SKEW_SECONDS = 5 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export function getSessionSecret(env) {
  return env.SESSION_SECRET || env.IVAO_CLIENT_SECRET || "";
}

export async function encodeSession(session, secret) {
  if (!secret) throw new Error("Missing SESSION_SECRET or IVAO_CLIENT_SECRET");

  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(session)));
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export function sessionMaxAgeSeconds(session) {
  return session?.isThailandStaff
    ? STAFF_SESSION_MAX_AGE_SECONDS
    : MEMBER_SESSION_MAX_AGE_SECONDS;
}

export function inspectSession(session, now = Date.now()) {
  const createdAt = new Date(session?.createdAt).getTime();
  if (!Number.isFinite(createdAt) || createdAt > now + CLOCK_SKEW_SECONDS * 1000) {
    return { valid: false, reason: "INVALID", remainingSeconds: 0 };
  }

  const expiresAt = createdAt + sessionMaxAgeSeconds(session) * 1000;
  if (now >= expiresAt) {
    return { valid: false, reason: "EXPIRED", expiresAt, remainingSeconds: 0 };
  }

  const lastActivityAt = new Date(session?.lastActivityAt || session?.createdAt).getTime();
  if (!Number.isFinite(lastActivityAt) || lastActivityAt > now + CLOCK_SKEW_SECONDS * 1000) {
    return { valid: false, reason: "INVALID", expiresAt, remainingSeconds: 0 };
  }
  if (now - lastActivityAt >= SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
    return { valid: false, reason: "IDLE", expiresAt, remainingSeconds: 0 };
  }

  return {
    valid: true,
    reason: null,
    expiresAt,
    remainingSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)),
  };
}

export async function decodeSessionToken(token, secret) {
  try {
    if (!secret) return null;
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const key = await importHmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;

    return JSON.parse(decoder.decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
}

export async function verifySessionToken(token, secret) {
  const session = await decodeSessionToken(token, secret);
  return session && inspectSession(session).valid ? session : null;
}

export function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

function secureAttribute(request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function makeCookie(request, name, value, maxAge = MEMBER_SESSION_MAX_AGE_SECONDS) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttribute(request)}`;
}

export function clearCookie(request, name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureAttribute(request)}`;
}

export async function getRequestSession(request, env) {
  const state = await getRequestSessionState(request, env);
  return state.valid ? state.session : null;
}

export async function getRequestSessionState(request, env) {
  const token = getCookie(request, "ivao_session");
  if (!token) return { token: null, session: null, valid: false, reason: "MISSING", remainingSeconds: 0 };
  const session = await decodeSessionToken(token, getSessionSecret(env));
  if (!session) return { token, session: null, valid: false, reason: "INVALID", remainingSeconds: 0 };
  return { token, session, ...inspectSession(session) };
}
