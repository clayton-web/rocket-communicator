import { NextResponse } from 'next/server';
import {
  createOwnerRecipient,
  listOwnerRecipients,
  parseCreateRecipientBody,
  runOwnerRecipientRoute,
} from '@/lib/recipients';
import {
  parseLimitQuery,
  readJsonBody,
  requireJsonContentType,
  requireObjectBody,
} from '@/lib/http/request';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: Request) {
  return runOwnerRecipientRoute(request, async (ctx) => {
    const url = new URL(request.url);
    const limitParsed = parseLimitQuery(url.searchParams.get('limit'));
    if (!limitParsed.ok) {
      return limitParsed.response;
    }
    const page = await listOwnerRecipients({
      db: ctx.db,
      owner: ctx.owner,
      cursor: url.searchParams.get('cursor'),
      limit: limitParsed.limit,
    });
    return NextResponse.json(page, { headers: NO_STORE });
  });
}

export async function POST(request: Request) {
  return runOwnerRecipientRoute(request, async (ctx) => {
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
    const parsed = parseCreateRecipientBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }
    const result = await createOwnerRecipient({
      db: ctx.db,
      owner: ctx.owner,
      now: ctx.now,
      requestId: ctx.requestId,
      displayName: parsed.value.displayName,
      email: parsed.value.email,
      relationshipLabel: parsed.value.relationshipLabel,
    });
    return NextResponse.json(result.recipient, { status: 201, headers: NO_STORE });
  });
}
