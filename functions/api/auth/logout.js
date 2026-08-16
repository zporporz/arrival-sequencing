import { clearCookie } from "../../_lib/session.js";

export async function onRequestGet({ request }) {
  const headers = new Headers({
    Location: new URL("/", new URL(request.url).origin).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", clearCookie(request, "ivao_session"));
  return new Response(null, { status: 302, headers });
}
