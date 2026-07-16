import { NextResponse } from 'next/server';
import { getGmailConnection } from '@/lib/gmail/service';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';

export const runtime = 'nodejs';

/**
 * GET /api/v1/gmail/connection
 * Authenticated Owner-only connection status. No database mutation and no Gmail API call.
 */
export async function GET(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const connection = await getGmailConnection({ owner: ctx.owner, db: ctx.db });
    return NextResponse.json(connection);
  });
}
