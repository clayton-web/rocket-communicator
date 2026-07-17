import { NextResponse } from 'next/server';
import { parseLimitQuery } from '@/lib/http/request';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { listOwnerGmailSyncRuns } from '@/lib/gmail/sync-service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/v1/gmail/sync-runs
 * Authenticated Owner-only cursor-paginated sync-run listing. Non-mutating.
 */
export async function GET(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const url = new URL(request.url);
    const limitParsed = parseLimitQuery(url.searchParams.get('limit'));
    if (!limitParsed.ok) {
      return limitParsed.response;
    }
    const cursor = url.searchParams.get('cursor');
    const page = await listOwnerGmailSyncRuns(
      { owner: ctx.owner, db: ctx.db },
      { cursor, limit: limitParsed.limit },
    );
    return NextResponse.json(
      { items: page.items, nextCursor: page.nextCursor },
      { headers: NO_STORE },
    );
  });
}
