import { NextResponse } from 'next/server';
import { startGmailOAuth } from '@/lib/gmail/service';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST /api/v1/gmail/oauth/start
 * Authenticated Owner-only. Creates hashed state + encrypted PKCE, audits start, and
 * redirects to Google. Never returns raw state, PKCE verifier, or secrets in the body.
 * Prefetch-safe: mutations require POST, not GET.
 */
export async function POST(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const returnPath = new URL(request.url).searchParams.get('returnPath');
    const { authUrl } = await startGmailOAuth(
      {
        owner: ctx.owner,
        db: ctx.db,
        now: ctx.now,
        requestId: ctx.requestId,
      },
      { returnPath },
    );
    return NextResponse.redirect(authUrl, { status: 302, headers: NO_STORE });
  });
}
