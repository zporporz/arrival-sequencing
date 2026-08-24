import { supabaseAdminRequest } from '../../_lib/supabaseAdmin.js';

const ACTIVE_WINDOW_MS = 35 * 1000;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanPresenceKey(value) {
  const key = cleanText(value, 96);
  return key && /^[A-Za-z0-9:_-]+$/.test(key) ? key : null;
}

function scopedPresenceKey(auth, browserId) {
  return `${String(auth.vid).slice(0, 24)}:${browserId}`;
}

function cleanIso(value) {
  const millis = new Date(String(value || '')).getTime();
  const now = Date.now();
  return Number.isFinite(millis) && millis >= now - 7 * 24 * 60 * 60 * 1000 && millis <= now + 60 * 1000
    ? new Date(millis).toISOString()
    : new Date(now).toISOString();
}

function authenticatedDisplayName(auth) {
  const vid = String(auth.vid);
  if (!auth.isThailandStaff) return `${cleanText(auth.name, 120) || 'IVAO'} · ${vid}`;
  const codes = Array.isArray(auth.staffPositionCodes)
    ? auth.staffPositionCodes.map((value) => cleanText(value, 20)?.toUpperCase()).filter(Boolean)
    : [];
  return `${codes.length ? [...new Set(codes)].join(' / ') : 'TH STAFF'} · ${vid}`;
}

function controllerRow(row) {
  return {
    key: row.presence_key,
    displayName: row.display_name,
    vid: row.vid || null,
    roleLabel: row.role_label || null,
    staffPositions: Array.isArray(row.staff_positions) ? row.staff_positions : [],
    onlineAt: row.online_at || null,
    airportView: row.airport_view || null,
  };
}

export async function onRequestGet(context) {
  try {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const result = await supabaseAdminRequest(
      context.env,
      `aman_online_presence?select=*&last_seen_at=gte.${encodeURIComponent(cutoff)}&order=display_name.asc`,
    );
    return json({ controllers: (result.data || []).map(controllerRow) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const auth = context.data.auth;
    const browserId = cleanPresenceKey(payload?.browserId);
    if (!browserId) throw new Error('Valid browser identity is required');
    const presenceKey = scopedPresenceKey(auth, browserId);

    if (String(payload?.action || 'track') === 'leave') {
      await supabaseAdminRequest(
        context.env,
        `aman_online_presence?presence_key=eq.${encodeURIComponent(presenceKey)}&vid=eq.${encodeURIComponent(String(auth.vid))}`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      );
      return json({ ok: true });
    }

    const now = new Date().toISOString();
    const positions = Array.isArray(auth.staffPositions)
      ? auth.staffPositions.map((value) => cleanText(value, 120)).filter(Boolean).slice(0, 20)
      : [];
    const result = await supabaseAdminRequest(
      context.env,
      'aman_online_presence?on_conflict=presence_key&select=*',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{
          presence_key: presenceKey,
          vid: String(auth.vid),
          display_name: authenticatedDisplayName(auth),
          role_label: auth.isThailandStaff ? 'TH STAFF' : 'IVAO MEMBER',
          staff_positions: positions,
          airport_view: cleanText(payload?.airportView, 80),
          online_at: cleanIso(payload?.onlineAt),
          last_seen_at: now,
        }]),
      },
    );
    return json({ ok: true, controller: result.data?.[0] ? controllerRow(result.data[0]) : null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
}
