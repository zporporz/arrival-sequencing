import { keepAuditWriteAlive, endLoginAudit, updateLoginActivity } from "../../_lib/loginAudit.js";
import {
  clearCookie,
  encodeSession,
  getRequestSessionState,
  getSessionSecret,
  inspectSession,
  makeCookie,
} from "../../_lib/session.js";

function json(body, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(body, {
    status,
    headers: responseHeaders,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);

  const state = await getRequestSessionState(request, env);
  if (!state.valid) {
    if (state.session && (state.reason === "IDLE" || state.reason === "EXPIRED")) {
      keepAuditWriteAlive(context, endLoginAudit(env, state.session, state.reason), "Unable to close IVAO login audit");
    }
    const headers = new Headers();
    headers.append("Set-Cookie", clearCookie(request, "ivao_session"));
    return json({ authenticated: false, reason: state.reason }, 401, headers);
  }

  const session = { ...state.session, lastActivityAt: new Date().toISOString() };
  const lifecycle = inspectSession(session);
  const token = await encodeSession(session, getSessionSecret(env));
  const headers = new Headers();
  headers.append("Set-Cookie", makeCookie(request, "ivao_session", token, lifecycle.remainingSeconds));
  keepAuditWriteAlive(context, updateLoginActivity(env, session), "Unable to update IVAO login activity");
  return json({ authenticated: true, lastActivityAt: session.lastActivityAt }, 200, headers);
}
