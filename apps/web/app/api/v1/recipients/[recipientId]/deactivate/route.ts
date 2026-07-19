import { NextResponse } from 'next/server';
import {
  assertRecipientId,
  deactivateOwnerRecipient,
  runOwnerRecipientRoute,
} from '@/lib/recipients';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ recipientId: string }> },
) {
  return runOwnerRecipientRoute(request, async (ctx) => {
    const { recipientId } = await context.params;
    const idCheck = assertRecipientId(recipientId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const result = await deactivateOwnerRecipient({
      db: ctx.db,
      owner: ctx.owner,
      now: ctx.now,
      requestId: ctx.requestId,
      recipientId,
    });
    return NextResponse.json(result.recipient, { headers: NO_STORE });
  });
}
