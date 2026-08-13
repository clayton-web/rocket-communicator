import 'server-only';
import {
  isGmailInboxEligible,
  type CommunicationEvent,
  type OwnerActor,
  type TemporaryCommunicationExcerpt,
} from '@aicaa/domain';
import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { GmailRequestError } from './errors';
import type { GmailInterpretationProvenance } from '@/lib/interpretation/validate';

export interface OwnerGmailIntakeContext {
  owner: OwnerActor;
  db: DbClient;
  now: string;
}

export type GmailReviewSource = {
  event: CommunicationEvent;
  excerpt: TemporaryCommunicationExcerpt;
  provenance: GmailInterpretationProvenance;
  rawInput: string;
  capturedAt: string;
};

export type GmailReviewResolution =
  | { ok: true; source: GmailReviewSource }
  | { ok: false; code: 'not_found' | 'excerpt_unavailable' };

/**
 * Current Inbox eligibility required to *start* a new Gmail interpretation (D179).
 *
 * Exact D161 replay classification does not use this: a previously committed occurrence may be
 * replayed after the source leaves Inbox, as long as the temporary excerpt still exists so the
 * fingerprint can be reconstructed.
 */
export function isGmailCurrentlyEligibleForNewInterpretation(event: CommunicationEvent): boolean {
  return event.status === 'active' && isGmailInboxEligible(event.labelIds);
}

/** Thrown only when a *new* Gmail interpretation is refused for current Inbox ineligibility. */
export class GmailNewInterpretationIneligibleError extends Error {
  readonly code = 'ineligible' as const;

  constructor() {
    super('This Gmail message is not eligible for Review with Rocket.');
    this.name = 'GmailNewInterpretationIneligibleError';
  }
}

function isExcerptCurrentlyAvailable(
  excerpt: TemporaryCommunicationExcerpt | null,
  now: string,
): excerpt is TemporaryCommunicationExcerpt {
  if (excerpt == null) {
    return false;
  }
  if (excerpt.purgedAt != null) {
    return false;
  }
  if (excerpt.content.trim().length === 0) {
    return false;
  }
  return Date.parse(excerpt.purgeAt) > Date.parse(now);
}

/**
 * Owner-authenticated Gmail intake list (D179 / S7).
 *
 * Reuses A5 CommunicationEvent + TemporaryCommunicationExcerpt only. Does not call A6 extraction,
 * claim/lease processing, or the shared interpretation provider.
 */
export async function listOwnerGmailIntake(
  ctx: OwnerGmailIntakeContext,
  query: { cursor?: string | null; limit?: number },
): Promise<{ items: CommunicationEvent[]; nextCursor: string | null }> {
  const runtime = await loadDbRuntime();
  try {
    return await runtime.listEligibleGmailIntakeEvents(ctx.db, {
      organizationId: ctx.owner.organizationId,
      now: ctx.now,
      cursor: query.cursor,
      limit: query.limit,
    });
  } catch (error) {
    if (runtime.isPersistenceError(error) && error.code === 'VALIDATION') {
      throw new GmailRequestError('validation', 'Gmail intake list cursor is invalid.');
    }
    throw error;
  }
}

/**
 * Resolve one Gmail occurrence for Review with Rocket from existing A5 data (D179).
 *
 * Loads the A5 event and its temporary excerpt so the shared interpretation service can
 * reconstruct the D161 fingerprint. Current Inbox eligibility is *not* applied here: that gate
 * belongs only to a new interpretation, after replay/conflict classification.
 *
 * Fail closed: missing/other-org/non-Gmail is `not_found`; missing/expired/empty excerpt is
 * `excerpt_unavailable`. A purged excerpt cannot reconstruct a fingerprint, so this remains
 * fail-closed rather than inventing key-only replay. A6 processing status is ignored.
 */
export async function resolveGmailReviewSource(
  ctx: OwnerGmailIntakeContext,
  communicationEventId: string,
): Promise<GmailReviewResolution> {
  const runtime = await loadDbRuntime();
  let event: CommunicationEvent;
  try {
    event = await runtime.getCommunicationEventById(
      ctx.db,
      ctx.owner.organizationId,
      communicationEventId,
    );
  } catch (error) {
    if (runtime.isPersistenceError(error) && error.code === 'NOT_FOUND') {
      return { ok: false, code: 'not_found' };
    }
    throw error;
  }

  if (event.sourceType !== 'gmail') {
    return { ok: false, code: 'not_found' };
  }

  const excerpt = await runtime.getTemporaryCommunicationExcerptByEventId(
    ctx.db,
    ctx.owner.organizationId,
    event.id,
  );
  if (!isExcerptCurrentlyAvailable(excerpt, ctx.now)) {
    return { ok: false, code: 'excerpt_unavailable' };
  }

  return {
    ok: true,
    source: {
      event,
      excerpt,
      rawInput: excerpt.content,
      capturedAt: event.receivedAt,
      provenance: {
        communicationEventId: event.id,
        providerMessageId: event.providerMessageId,
        providerThreadId: event.providerThreadId,
        excerptId: excerpt.id,
        excerptByteLength: excerpt.byteLength,
        subject: event.subject,
        fromAddress: event.fromAddress,
        dedupeKey: event.dedupeKey,
      },
    },
  };
}
