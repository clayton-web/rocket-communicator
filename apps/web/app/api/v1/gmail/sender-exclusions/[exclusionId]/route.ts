import { NextResponse } from 'next/server';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { assertGmailSenderExclusionId } from '@/lib/gmail/validate-exclusion-body';
import { removeGmailSenderExclusion } from '@/lib/gmail/sender-exclusion-service';
import {
  gmailReviewUnavailableResponse,
  isGmailReviewEnabled,
} from '@/lib/gmail/review-release-config';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * DELETE /api/v1/gmail/sender-exclusions/{exclusionId}
 *
 * Removes one organization-scoped Gmail sender exclusion (D180 / S7). Other-organization ids are
 * indistinguishable from missing. This is not a sender-management list surface.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ exclusionId: string }> },
) {
  if (!isGmailReviewEnabled()) {
    return gmailReviewUnavailableResponse();
  }
  return runOwnerGmailRoute(request, async (ctx) => {
    const { exclusionId } = await context.params;
    const idCheck = assertGmailSenderExclusionId(exclusionId);
    if (!idCheck.ok) {
      return withNoStore(idCheck.response);
    }

    const exclusion = await removeGmailSenderExclusion(
      {
        owner: ctx.owner,
        db: ctx.db,
        now: ctx.now,
        requestId: ctx.requestId,
      },
      exclusionId,
    );
    return NextResponse.json(exclusion, { status: 200, headers: NO_STORE });
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
