import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/server';
import { logDatabaseRuntimeFailure } from '@/lib/db/diagnostics';
import { handleGmailCallback } from '@/lib/gmail/service';
import { DEFAULT_GMAIL_RETURN_PATH, getGmailOAuthConfig } from '@/lib/gmail/config';
import { buildReturnUrl } from '@/lib/gmail/safe-redirect';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/v1/gmail/oauth/callback
 * Public Google redirect endpoint protected by state hash + PKCE. Always redirects to a
 * safe same-origin destination; never places tokens or raw OAuth errors in the URL.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestId = randomUUID();
  try {
    const db = await getDb();
    const result = await handleGmailCallback(
      { db, now: new Date().toISOString(), requestId },
      {
        code: requestUrl.searchParams.get('code'),
        state: requestUrl.searchParams.get('state'),
        error: requestUrl.searchParams.get('error'),
      },
    );
    return NextResponse.redirect(result.redirectUrl, { status: 302, headers: NO_STORE });
  } catch (error) {
    logDatabaseRuntimeFailure(error, {
      routePathname: requestUrl.pathname,
      requestId,
    });
    let appUrl = 'http://localhost:3000';
    try {
      appUrl = getGmailOAuthConfig().appUrl;
    } catch {
      appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || appUrl;
    }
    return NextResponse.redirect(
      buildReturnUrl(appUrl, DEFAULT_GMAIL_RETURN_PATH, {
        key: 'gmail_error',
        value: 'server_error',
      }),
      { status: 302, headers: NO_STORE },
    );
  }
}
