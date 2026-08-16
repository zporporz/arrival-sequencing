export async function onRequestGet({ data }) {
  return Response.json({ ok: true, user: data.auth }, { headers: { "Cache-Control": "no-store" } });
}
