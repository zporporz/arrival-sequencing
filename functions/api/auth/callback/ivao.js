import { buildSessionFromIvaoUser } from "../../../_lib/ivao.js";
import {
  clearCookie,
  encodeSession,
  getCookie,
  getSessionSecret,
  makeCookie,
} from "../../../_lib/session.js";
import { supabaseAdminRequest } from "../../../_lib/supabaseAdmin.js";

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

async function recordSuccessfulLogin(env, session) {
  const positions = Array.isArray(session.staffPositions)
    ? session.staffPositions.map((value) => String(value).trim()).filter(Boolean).slice(0, 20)
    : [];
  await supabaseAdminRequest(env, "ivao_login_audit", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      vid: String(session.vid),
      name: String(session.name || session.vid),
      public_nickname: session.publicNickname || null,
      role: session.isThailandStaff ? "STAFF" : "MEMBER",
      is_thailand_staff: Boolean(session.isThailandStaff),
      staff_positions: positions,
      division_id: session.divisionId || null,
      country_id: session.countryId || null,
      atc_rating: session.atcRating || null,
      pilot_rating: session.pilotRating || null,
      logged_in_at: new Date().toISOString(),
    }]),
  });
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
  const session = buildSessionFromIvaoUser(user);
  const sessionToken = await encodeSession(session, getSessionSecret(env));
  const auditWrite = recordSuccessfulLogin(env, session).catch((error) => {
    console.error("Unable to record IVAO login audit", error);
  });
  if (typeof context.waitUntil === "function") context.waitUntil(auditWrite);
  else await auditWrite;

  const headers = new Headers({
    Location: redirectHome(request, "success"),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", clearCookie(request, "ivao_oauth_state"));
  headers.append("Set-Cookie", makeCookie(request, "ivao_session", sessionToken));

  return new Response(null, { status: 302, headers });
}
