const TOKEN_URL = 'https://identity.api.navigraph.com/connect/token';
const PACKAGES_URL = 'https://api.navigraph.com/v1/navdata/packages';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

function credentials(env) {
  const clientId = String(env.NAVIGRAPH_CLIENT_ID || '').trim();
  const clientSecret = String(env.NAVIGRAPH_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

async function getAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'fmsdata',
    grant_type: 'client_credentials',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Navigraph token request failed: ${detail}`);
  }
  return payload.access_token;
}

function sanitizePackages(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map((pkg) => ({
    packageId: pkg?.package_id || null,
    cycle: pkg?.cycle || null,
    revision: pkg?.revision || null,
    description: pkg?.description || null,
    format: pkg?.format || null,
    packageStatus: pkg?.package_status || null,
    formatType: pkg?.format_type || null,
    files: Array.isArray(pkg?.files)
      ? pkg.files.map((file) => ({
          fileId: file?.file_id || null,
          key: file?.key || null,
          hash: file?.hash || null,
        }))
      : [],
  }));
}

export async function onRequestGet(context) {
  const { clientId, clientSecret } = credentials(context.env);
  if (!clientId || !clientSecret) {
    return json({
      ok: false,
      configured: false,
      error: 'NAVIGRAPH_CLIENT_ID and NAVIGRAPH_CLIENT_SECRET are not configured',
    }, 503);
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const response = await fetch(PACKAGES_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
      throw new Error(`Navigraph packages request failed: ${detail}`);
    }

    const packages = sanitizePackages(payload);
    return json({
      ok: true,
      configured: true,
      packageCount: packages.length,
      packages,
    });
  } catch (error) {
    return json({
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}
