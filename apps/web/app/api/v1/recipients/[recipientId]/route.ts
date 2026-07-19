import { NextResponse } from 'next/server';
import {
  assertRecipientId,
  parseUpdateRecipientBody,
  runOwnerRecipientRoute,
  updateOwnerRecipient,
} from '@/lib/recipients';
import { readJsonBody, requireJsonContentType, requireObjectBody } from '@/lib/http/request';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ recipientId: string }> },
) {
  return runOwnerRecipientRoute(request, async (ctx) => {
    const { recipientId } = await context.params;
    const idCheck = assertRecipientId(recipientId);
    if (!idCheck.ok) {
      return idCheck.response;
    }
    const contentType = requireJsonContentType(request);
    if (!contentType.ok) {
      return contentType.response;
    }
    const json = await readJsonBody(request);
    if (!json.ok) {
      return json.response;
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return object.response;
    }
    const parsed = parseUpdateRecipientBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }
    const result = await updateOwnerRecipient({
      db: ctx.db,
      owner: ctx.owner,
      now: ctx.now,
      requestId: ctx.requestId,
      recipientId,
      update: parsed.value,
    });
    return NextResponse.json(result.recipient, { headers: NO_STORE });
  });
}
