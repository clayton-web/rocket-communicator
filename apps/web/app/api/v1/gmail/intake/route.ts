import { NextResponse } from 'next/server';
import { parseLimitQuery } from '@/lib/http/request';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { mapGmailIntakeItem } from '@/lib/gmail/intake-dto';
import { listOwnerGmailIntake } from '@/lib/gmail/intake-service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/v1/gmail/intake
 *
 * Owner-authenticated Gmail intake read surface (D179 / S7). Lists currently reviewable Gmail
 * occurrences already stored by A5. Not a generic CommunicationEvent browser: only eligible Gmail
 * with a live temporary excerpt is returned, and excerpt bodies are not exposed.
 */
export async function GET(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const url = new URL(request.url);
    const limitParsed = parseLimitQuery(url.searchParams.get('limit'));
    if (!limitParsed.ok) {
      return withNoStore(limitParsed.response);
    }
    const cursor = url.searchParams.get('cursor');
    const page = await listOwnerGmailIntake(
      { owner: ctx.owner, db: ctx.db, now: ctx.now },
      { cursor, limit: limitParsed.limit },
    );
    return NextResponse.json(
      {
        items: page.items.map(mapGmailIntakeItem),
        nextCursor: page.nextCursor,
      },
      { headers: NO_STORE },
    );
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
