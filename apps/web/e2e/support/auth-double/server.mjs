/**
 * Local Supabase Auth double for the P1.2 browser harness (D119).
 *
 * Implements only the endpoints `@supabase/ssr` / `@supabase/supabase-js` call during
 * the Owner sign-in journey, so the harness can drive the REAL application login flow
 * (authorize -> /auth/callback -> exchangeCodeForSession -> getUser) without a Google
 * account and without changing any production authentication code.
 *
 * Security properties:
 * - Binds to 127.0.0.1 only.
 * - Issues opaque, unsigned, locally-scoped tokens that authorize nothing anywhere else.
 * - Reachable only when NEXT_PUBLIC_SUPABASE_URL points at this loopback port, which is
 *   never true in production (production points at the real Supabase project).
 * - Never contacts Google, Supabase, or any network service.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.E2E_AUTH_PORT ?? 54329);
const WORKSPACE_DOMAIN = process.env.E2E_WORKSPACE_DOMAIN ?? 'e2e.invalid';
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? `owner@${WORKSPACE_DOMAIN}`;
const OWNER_ID = process.env.E2E_OWNER_ID ?? '00000000-0000-4000-8000-00000000e2e1';

/**
 * When set, the double omits the verified Google hosted-domain claim so the harness can
 * exercise the application's real domain-allowlist rejection path.
 */
let hostedDomainOverride = null;

/**
 * Real Supabase Auth HTTP-operation counters (P1.4 / D119).
 *
 * The D119 gate is "exactly one Owner authentication call per Owner page request", and
 * P1.4 puts the Owner shell in a layout, which renders alongside the page. Counting source
 * call sites would prove nothing about that, so the double counts the operations the
 * application actually performs against the Auth protocol:
 *
 * - `user`    — `GET /auth/v1/user`, the server-verified identity operation D119 budgets;
 * - `token`   — `POST /auth/v1/token`, session refresh and code exchange (cookie
 *               maintenance), counted separately so a refresh is never mistaken for an
 *               identity verification;
 * - `logout`  — `POST /auth/v1/logout`, server-side sign-out.
 *
 * This is harness-only instrumentation on a loopback test server. No counter, header, or
 * hook is added to application code, so nothing here can reach production.
 */
const operations = { user: 0, token: 0, logout: 0 };

const NOW_ISO = new Date().toISOString();

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** Well-formed but unsigned local token. Decodable for expiry; authorizes nothing. */
function localAccessToken() {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: OWNER_ID,
      email: OWNER_EMAIL,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  return `${header}.${payload}.e2e-local-not-a-signature`;
}

function ownerUser() {
  const hostedDomain = hostedDomainOverride === null ? WORKSPACE_DOMAIN : hostedDomainOverride;
  const identityData = {
    email: OWNER_EMAIL,
    email_verified: true,
    full_name: 'E2E Owner',
    name: 'E2E Owner',
    provider_id: OWNER_ID,
    sub: OWNER_ID,
  };
  // Omitting `hd` reproduces a non-Workspace Google account.
  if (hostedDomain !== '') {
    identityData.hd = hostedDomain;
  }

  return {
    id: OWNER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: OWNER_EMAIL,
    email_confirmed_at: NOW_ISO,
    phone: '',
    confirmed_at: NOW_ISO,
    last_sign_in_at: NOW_ISO,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'E2E Owner', email: OWNER_EMAIL },
    identities: [
      {
        identity_id: '00000000-0000-4000-8000-00000000e2e2',
        id: OWNER_ID,
        user_id: OWNER_ID,
        identity_data: identityData,
        provider: 'google',
        last_sign_in_at: NOW_ISO,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
      },
    ],
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    is_anonymous: false,
  };
}

function session() {
  return {
    access_token: localAccessToken(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-local-refresh-token',
    user: ownerUser(),
  };
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  // Harness control surface (local only): choose whether the Google identity carries `hd`.
  if (url.pathname === '/__e2e__/hosted-domain' && request.method === 'POST') {
    // The server binds loopback, but a page open in a developer's browser could still POST
    // here while the harness runs. Only same-origin/loopback callers may change the claim.
    const origin = request.headers.origin;
    if (origin !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(origin)) {
      sendJson(response, 403, { error: 'control surface is loopback-only' });
      return;
    }
    const body = await readBody(request);
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    hostedDomainOverride = typeof parsed.hostedDomain === 'string' ? parsed.hostedDomain : null;
    sendJson(response, 200, { hostedDomain: hostedDomainOverride });
    return;
  }

  if (url.pathname === '/__e2e__/health') {
    sendJson(response, 200, { ok: true, role: 'supabase-auth-double' });
    return;
  }

  /*
   * Auth operation counters. GET reads them; POST resets them so a spec can measure a
   * single page request in isolation. Same loopback-only guard as the hosted-domain
   * control surface: the server binds 127.0.0.1, but a developer's browser could still
   * reach it while the harness runs.
   */
  if (url.pathname === '/__e2e__/auth-operations') {
    const origin = request.headers.origin;
    if (origin !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(origin)) {
      sendJson(response, 403, { error: 'control surface is loopback-only' });
      return;
    }
    if (request.method === 'POST') {
      await readBody(request);
      operations.user = 0;
      operations.token = 0;
      operations.logout = 0;
    }
    sendJson(response, 200, {
      ...operations,
      total: operations.user + operations.token + operations.logout,
    });
    return;
  }

  // Browser OAuth entry: immediately redirect back to the application callback.
  if (url.pathname === '/auth/v1/authorize') {
    const redirectTo = url.searchParams.get('redirect_to');
    if (!redirectTo) {
      sendJson(response, 400, { error: 'missing redirect_to' });
      return;
    }
    const target = new URL(redirectTo);
    target.searchParams.set('code', 'e2e-local-auth-code');
    response.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  // Code exchange (PKCE) and refresh both yield the same local session.
  if (url.pathname === '/auth/v1/token') {
    operations.token += 1;
    await readBody(request);
    sendJson(response, 200, session());
    return;
  }

  if (url.pathname === '/auth/v1/user') {
    operations.user += 1;
    sendJson(response, 200, ownerUser());
    return;
  }

  if (url.pathname === '/auth/v1/logout') {
    operations.logout += 1;
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  if (url.pathname === '/auth/v1/settings') {
    sendJson(response, 200, { external: { google: true }, disable_signup: false });
    return;
  }

  sendJson(response, 404, { error: `unhandled auth double path ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`supabase-auth-double listening on http://127.0.0.1:${PORT}\n`);
});
