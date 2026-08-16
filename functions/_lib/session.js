const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
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

export async function verifySessionToken(token, secret) {
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

    const session = JSON.parse(decoder.decode(base64UrlToBytes(payload)));
    const createdAt = new Date(session.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return null;
    if (Date.now() - createdAt > SESSION_MAX_AGE_SECONDS * 1000) return null;

    return session;
  } catch {
    return null;
  }
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

export function makeCookie(request, name, value, maxAge = SESSION_MAX_AGE_SECONDS) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttribute(request)}`;
}

export function clearCookie(request, name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureAttribute(request)}`;
}

export async function getRequestSession(request, env) {
  const token = getCookie(request, "ivao_session");
  if (!token) return null;
  return verifySessionToken(token, getSessionSecret(env));
}
