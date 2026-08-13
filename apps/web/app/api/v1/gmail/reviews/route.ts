import { NextResponse } from 'next/server';
import {
  parseIdempotencyKey,
  readJsonBody,
  requireJsonContentType,
  requireObjectBody,
} from '@/lib/http/request';
import { jsonErrorResponse } from '@/lib/auth/http';
import { mapGmailReviewResponse } from '@/lib/interpretation/map-to-dto';
import { runOwnerInterpretationRoute } from '@/lib/interpretation/route-context';
import { interpretCapture } from '@/lib/interpretation/service';
import { parseGmailReviewBody } from '@/lib/gmail/validate-review-body';
import {
  GmailNewInterpretationIneligibleError,
  isGmailCurrentlyEligibleForNewInterpretation,
  resolveGmailReviewSource,
} from '@/lib/gmail/intake-service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The only interpretation provenance this route can produce (D179).
 *
 * Fixed as a server constant rather than read from the request, so provenance is a property of
 * which endpoint was called instead of a claim the caller makes. There is deliberately no generic
 * arbitrary-source interpretation endpoint.
 */
const GMAIL_SOURCE_KIND = 'gmail' as const;

/**
 * POST /api/v1/gmail/reviews
 *
 * Gmail-specific Owner-authenticated adapter over the shared interpretation service (D179 / S7).
 * Resolves one A5 Gmail occurrence and its temporary capped excerpt, then interprets with
 * server-fixed `sourceKind = gmail`. Fingerprinting, idempotency, the provider call, and
 * occurrence persistence stay in the shared interpretation service. Current Inbox eligibility
 * is required only to start a new interpretation; an exact D161 replay may return the already
 * persisted result after the source leaves Inbox, provided the excerpt still reconstructs the
 * fingerprint.
 *
 * HTTP 200 answers first success, exact replay, and zero proposals alike. No canonical Task is
 * created, nothing is approved, no responsibility is chosen, and no assignment is written.
 */
export async function POST(request: Request) {
  return runOwnerInterpretationRoute(request, async (ctx) => {
    const contentType = requireJsonContentType(request);
    if (!contentType.ok) {
      return withNoStore(contentType.response);
    }

    const idempotency = parseIdempotencyKey(request);
    if (!idempotency.ok) {
      return withNoStore(idempotency.response);
    }

    const json = await readJsonBody(request);
    if (!json.ok) {
      return withNoStore(json.response);
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return withNoStore(object.response);
    }
    const body = parseGmailReviewBody(object.value);
    if (!body.ok) {
      return withNoStore(body.response);
    }

    const resolved = await resolveGmailReviewSource(
      { owner: ctx.owner, db: ctx.db, now: ctx.now },
      body.value.communicationEventId,
    );
    if (!resolved.ok) {
      return withNoStore(gmailReviewFailure(resolved.code));
    }

    try {
      const result = await interpretCapture({
        db: ctx.db,
        request: {
          organizationId: ctx.owner.organizationId,
          sourceKind: GMAIL_SOURCE_KIND,
          rawInput: resolved.source.rawInput,
          idempotencyKey: idempotency.value,
          requestId: ctx.requestId,
          capturedAt: resolved.source.capturedAt,
          timezone: null,
          gmailProvenance: resolved.source.provenance,
        },
        now: ctx.now,
        beforeNewInterpretation: () => {
          if (!isGmailCurrentlyEligibleForNewInterpretation(resolved.source.event)) {
            throw new GmailNewInterpretationIneligibleError();
          }
        },
      });

      return NextResponse.json(mapGmailReviewResponse(result), {
        status: 200,
        headers: NO_STORE,
      });
    } catch (error) {
      if (error instanceof GmailNewInterpretationIneligibleError) {
        return withNoStore(gmailReviewFailure('ineligible'));
      }
      throw error;
    }
  });
}

function gmailReviewFailure(
  code: 'not_found' | 'ineligible' | 'excerpt_unavailable',
): NextResponse {
  if (code === 'not_found') {
    return jsonErrorResponse('NOT_FOUND', 'Gmail message was not found.', 404);
  }
  if (code === 'ineligible') {
    return jsonErrorResponse(
      'DOMAIN_CONFLICT',
      'This Gmail message is not eligible for Review with Rocket.',
      409,
    );
  }
  return jsonErrorResponse('DOMAIN_CONFLICT', 'Gmail message content is no longer available.', 409);
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
