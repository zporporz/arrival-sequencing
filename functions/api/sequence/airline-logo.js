function cleanIcao(value) {
  const icao = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{3}$/.test(icao) ? icao : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const icao = cleanIcao(url.searchParams.get('icao'));
  if (!icao) return Response.json({ error: 'Valid airline ICAO is required' }, { status: 400 });
  if (!context.env.IVAO_API_KEY) return Response.json({ error: 'IVAO_API_KEY is not configured' }, { status: 503 });

  try {
    const response = await fetch(`https://api.ivao.aero/v2/airlines/${encodeURIComponent(icao)}/logo`, {
      headers: { apiKey: context.env.IVAO_API_KEY },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });

    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'image/png');
    headers.set('Cache-Control', 'private, max-age=86400');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response(null, { status: 502 });
  }
}
