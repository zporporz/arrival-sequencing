import { buildSessionFromIvaoUser } from "../../../_lib/ivao.js";
import { keepAuditWriteAlive, recordSuccessfulLogin } from "../../../_lib/loginAudit.js";
import {
  clearCookie,
  encodeSession,
  getCookie,
  getSessionSecret,
  inspectSession,
  makeCookie,
} from "../../../_lib/session.js";

const IVAO_TOKEN_URL = "https://api.ivao.aero/v2/oauth/token";
const IVAO_USERINFO_URL = "https://api.ivao.aero/v2/users/me";

function redirectUri(request, env) {
  return env.IVAO_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/callback/ivao`;
}

function redirectHome(request, reason = null) {
  const url = new URL("/", new URL(request.url).origin);
  if (reason) url.searchParams.set("login", reason);
  return url.toString();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = getCookie(request, "ivao_oauth_state");

  if (!code || !state || !savedState || state !== savedState) {
    return Response.redirect(redirectHome(request, "failed"), 302);
  }

  if (!env.IVAO_CLIENT_ID || !env.IVAO_CLIENT_SECRET || !getSessionSecret(env)) {
    return Response.json({ error: "Missing IVAO OAuth/session secrets" }, { status: 500 });
  }

  const tokenResponse = await fetch(IVAO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request, env),
      client_id: env.IVAO_CLIENT_ID,
      client_secret: env.IVAO_CLIENT_SECRET,
    }),
  });

  if (!tokenResponse.ok) {
    return Response.redirect(redirectHome(request, "token_failed"), 302);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return Response.redirect(redirectHome(request, "token_failed"), 302);
  }

  const userResponse = await fetch(IVAO_USERINFO_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    return Response.redirect(redirectHome(request, "user_failed"), 302);
  }

  const user = await userResponse.json();
  const baseSession = buildSessionFromIvaoUser(user);
  const session = {
    ...baseSession,
    sessionId: crypto.randomUUID(),
    lastActivityAt: baseSession.createdAt,
  };
  const lifecycle = inspectSession(session);
  const sessionToken = await encodeSession(session, getSessionSecret(env));
  const auditWrite = keepAuditWriteAlive(
    context,
    recordSuccessfulLogin(env, session, lifecycle.expiresAt),
    "Unable to record IVAO login audit",
  );
  if (typeof context.waitUntil !== "function") await auditWrite;

  const headers = new Headers({
    Location: redirectHome(request, "success"),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", clearCookie(request, "ivao_oauth_state"));
  headers.append("Set-Cookie", makeCookie(request, "ivao_session", sessionToken, lifecycle.remainingSeconds));

  return new Response(null, { status: 302, headers });
}
