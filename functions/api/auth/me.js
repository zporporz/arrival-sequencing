import { getRequestSession } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await getRequestSession(request, env);
  const headers = { "Cache-Control": "no-store" };

  if (!session) {
    return Response.json({ authenticated: false }, { status: 401, headers });
  }

  return Response.json({ authenticated: true, user: session }, { headers });
}
