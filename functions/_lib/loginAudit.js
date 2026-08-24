import { supabaseAdminRequest } from "./supabaseAdmin.js";

const END_REASONS = new Set(["SIGN_OUT", "IDLE", "EXPIRED"]);

function normalizedPositions(session) {
  return Array.isArray(session.staffPositions)
    ? session.staffPositions.map((value) => String(value).trim()).filter(Boolean).slice(0, 20)
    : [];
}

export async function recordSuccessfulLogin(env, session, expiresAt) {
  await supabaseAdminRequest(env, "ivao_login_audit", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      session_id: session.sessionId,
      vid: String(session.vid),
      name: String(session.name || session.vid),
      public_nickname: session.publicNickname || null,
      role: session.isThailandStaff ? "STAFF" : "MEMBER",
      is_thailand_staff: Boolean(session.isThailandStaff),
      staff_positions: normalizedPositions(session),
      division_id: session.divisionId || null,
      country_id: session.countryId || null,
      atc_rating: session.atcRating || null,
      pilot_rating: session.pilotRating || null,
      logged_in_at: session.createdAt,
      last_activity_at: session.lastActivityAt,
      expires_at: new Date(expiresAt).toISOString(),
    }]),
  });
}

export async function updateLoginActivity(env, session) {
  if (!session?.sessionId) return;
  await supabaseAdminRequest(
    env,
    `ivao_login_audit?session_id=eq.${encodeURIComponent(session.sessionId)}&logged_out_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_activity_at: session.lastActivityAt }),
    },
  );
}

export async function endLoginAudit(env, session, reason) {
  if (!session?.sessionId) return;
  const endReason = END_REASONS.has(reason) ? reason : "SIGN_OUT";
  await supabaseAdminRequest(
    env,
    `ivao_login_audit?session_id=eq.${encodeURIComponent(session.sessionId)}&logged_out_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        logged_out_at: new Date().toISOString(),
        end_reason: endReason,
      }),
    },
  );
}

export function keepAuditWriteAlive(context, promise, message) {
  const guarded = promise.catch((error) => console.error(message, error));
  if (typeof context.waitUntil === "function") context.waitUntil(guarded);
  return guarded;
}
