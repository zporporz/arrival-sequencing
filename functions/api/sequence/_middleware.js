import { getRequestSession } from "../../_lib/session.js";

export async function onRequest(context) {
  const session = await getRequestSession(context.request, context.env);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  context.data.auth = session;
  return context.next();
}
