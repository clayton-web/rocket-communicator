import { NextResponse } from 'next/server';
import { readJsonBody, requireJsonContentType, requireObjectBody } from '@/lib/http/request';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { parseCreateGmailSenderExclusionBody } from '@/lib/gmail/validate-exclusion-body';
import { excludeGmailSenderFromEvent } from '@/lib/gmail/sender-exclusion-service';
import {
  gmailReviewUnavailableResponse,
  isGmailReviewEnabled,
} from '@/lib/gmail/review-release-config';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST /api/v1/gmail/sender-exclusions
 *
 * Owner-authenticated Gmail sender exclusion (D180 / S7). Resolves the sender from an existing
 * A5 Gmail CommunicationEvent and persists an organization-scoped preference. Already-excluded
 * senders return the existing row. Does not change A5 ingestion or A6 processing.
 */
export async function POST(request: Request) {
  if (!isGmailReviewEnabled()) {
    return gmailReviewUnavailableResponse();
  }
  return runOwnerGmailRoute(request, async (ctx) => {
    const contentType = requireJsonContentType(request);
    if (!contentType.ok) {
      return withNoStore(contentType.response);
    }

    const json = await readJsonBody(request);
    if (!json.ok) {
      return withNoStore(json.response);
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return withNoStore(object.response);
    }
    const body = parseCreateGmailSenderExclusionBody(object.value);
    if (!body.ok) {
      return withNoStore(body.response);
    }

    const exclusion = await excludeGmailSenderFromEvent(
      {
        owner: ctx.owner,
        db: ctx.db,
        now: ctx.now,
        requestId: ctx.requestId,
      },
      body.value.communicationEventId,
    );
    return NextResponse.json(exclusion, { status: 200, headers: NO_STORE });
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
