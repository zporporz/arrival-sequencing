const IVAO_AUTHORIZE_URL = "https://sso.ivao.aero/authorize";

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redirectUri(request, env) {
  return env.IVAO_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/callback/ivao`;
}

export async function onRequestGet({ request, env }) {
  if (!env.IVAO_CLIENT_ID) {
    return Response.json({ error: "Missing IVAO_CLIENT_ID" }, { status: 500 });
  }

  const state = randomState();
  const url = new URL(IVAO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.IVAO_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(request, env));
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    `ivao_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  );

  return new Response(null, { status: 302, headers });
}
