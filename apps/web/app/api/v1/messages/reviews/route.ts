import { NextResponse } from 'next/server';
import {
  parseIdempotencyKey,
  readJsonBody,
  requireJsonContentType,
  requireObjectBody,
} from '@/lib/http/request';
import { mapMessagesReviewResponse } from '@/lib/interpretation/map-to-dto';
import { runOwnerInterpretationRoute } from '@/lib/interpretation/route-context';
import { interpretCapture } from '@/lib/interpretation/service';
import {
  persistMessagesReviewExcerpt,
  persistPreparedMessagesReviewSource,
  prepareMessagesReviewSource,
} from '@/lib/messages/review-service';
import { parseMessagesReviewBody } from '@/lib/messages/validate-review-body';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The only interpretation provenance this route can produce (D181).
 *
 * Fixed as a server constant rather than read from the request, so provenance is a property of
 * which endpoint was called instead of a claim the caller makes. There is deliberately no generic
 * arbitrary-source interpretation endpoint.
 */
const MESSAGES_SOURCE_KIND = 'google_messages' as const;

/**
 * POST /api/v1/messages/reviews
 *
 * Messages-specific Owner-authenticated adapter over the shared interpretation service (D181).
 * Validates `observedAt` before any write, then lets D161 classify replay/conflict/new before
 * creating a CommunicationEvent or persisting selected text. A new interpretation creates or
 * reuses the canonical event without a CommunicationAccount and writes selected text only on
 * TemporaryCommunicationExcerpt. Fingerprinting, idempotency, the provider call, and
 * occurrence persistence stay in the shared interpretation service.
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
    const body = parseMessagesReviewBody(object.value);
    if (!body.ok) {
      return withNoStore(body.response);
    }

    const prepared = prepareMessagesReviewSource({
      organizationId: ctx.owner.organizationId,
      sourceOccurrenceId: body.value.sourceOccurrenceId,
      selectedText: body.value.selectedText,
      observedAt: body.value.observedAt,
    });

    let replaceExcerptAfterCommit = false;
    let persistedProvenance = prepared.provenance;

    const result = await interpretCapture({
      db: ctx.db,
      request: {
        organizationId: ctx.owner.organizationId,
        sourceKind: MESSAGES_SOURCE_KIND,
        rawInput: prepared.rawInput,
        idempotencyKey: idempotency.value,
        requestId: ctx.requestId,
        capturedAt: prepared.capturedAt,
        timezone: null,
        messagesProvenance: prepared.provenance,
      },
      now: ctx.now,
      beforeNewInterpretation: async () => {
        const persisted = await persistPreparedMessagesReviewSource(ctx.db, {
          organizationId: ctx.owner.organizationId,
          sourceOccurrenceId: body.value.sourceOccurrenceId,
          selectedText: body.value.selectedText,
          observedAt: body.value.observedAt,
          now: ctx.now,
          prepared,
        });
        replaceExcerptAfterCommit = persisted.replaceExcerptAfterCommit;
        persistedProvenance = persisted.provenance;
        return { messagesProvenance: persisted.provenance };
      },
    });

    if (result.outcome === 'created' && replaceExcerptAfterCommit) {
      await persistMessagesReviewExcerpt(ctx.db, {
        organizationId: ctx.owner.organizationId,
        communicationEventId: persistedProvenance.communicationEventId,
        excerptId: persistedProvenance.excerptId,
        selectedText: body.value.selectedText,
        now: ctx.now,
      });
    }

    return NextResponse.json(mapMessagesReviewResponse(result), {
      status: 200,
      headers: NO_STORE,
    });
  });
}

function withNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
