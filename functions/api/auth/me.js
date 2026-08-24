import { endLoginAudit, keepAuditWriteAlive } from "../../_lib/loginAudit.js";
import { clearCookie, getRequestSessionState } from "../../_lib/session.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const state = await getRequestSessionState(request, env);
  const headers = new Headers({ "Cache-Control": "no-store" });

  if (!state.valid) {
    if (state.token) headers.append("Set-Cookie", clearCookie(request, "ivao_session"));
    if (state.session && (state.reason === "IDLE" || state.reason === "EXPIRED")) {
      const auditWrite = keepAuditWriteAlive(
        context,
        endLoginAudit(env, state.session, state.reason),
        "Unable to close IVAO login audit",
      );
      if (typeof context.waitUntil !== "function") await auditWrite;
    }
    return Response.json({ authenticated: false, reason: state.reason }, { status: 401, headers });
  }

  const { sessionId: _sessionId, ...user } = state.session;
  return Response.json({ authenticated: true, user }, { headers });
}
