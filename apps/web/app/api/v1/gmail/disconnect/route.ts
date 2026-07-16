import { NextResponse } from 'next/server';
import { readJsonBody, requireObjectBody } from '@/lib/http/request';
import { disconnectGmail } from '@/lib/gmail/service';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';

export const runtime = 'nodejs';

/**
 * POST /api/v1/gmail/disconnect
 * Authenticated Owner-only. Requires explicit confirmation. Best-effort Google revocation;
 * local credential wipe always proceeds. Idempotent for already-disconnected accounts.
 */
export async function POST(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const json = await readJsonBody(request);
    if (!json.ok) {
      return json.response;
    }
    const body = requireObjectBody(json.body);
    if (!body.ok) {
      return body.response;
    }

    const connection = await disconnectGmail(
      {
        owner: ctx.owner,
        db: ctx.db,
        now: ctx.now,
        requestId: ctx.requestId,
      },
      { confirmation: body.value.confirmation },
    );
    return NextResponse.json({ connection });
  });
}
