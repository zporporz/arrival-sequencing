import { endLoginAudit, keepAuditWriteAlive } from "../../_lib/loginAudit.js";
import { clearCookie, getRequestSessionState } from "../../_lib/session.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const state = await getRequestSessionState(request, env);
  const requestedReason = new URL(request.url).searchParams.get("reason");
  const reason = state.reason === "IDLE" || state.reason === "EXPIRED"
    ? state.reason
    : requestedReason === "IDLE" ? "IDLE" : "SIGN_OUT";
  if (state.session) {
    const auditWrite = keepAuditWriteAlive(
      context,
      endLoginAudit(env, state.session, reason),
      "Unable to close IVAO login audit",
    );
    if (typeof context.waitUntil !== "function") await auditWrite;
  }

  const location = new URL("/", new URL(request.url).origin);
  if (reason === "IDLE") location.searchParams.set("login", "idle");
  if (reason === "EXPIRED") location.searchParams.set("login", "expired");
  const headers = new Headers({
    Location: location.toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", clearCookie(request, "ivao_session"));
  return new Response(null, { status: 302, headers });
}
