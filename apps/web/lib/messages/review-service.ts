import 'server-only';
import { randomBytes } from 'node:crypto';
import type { DbClient } from '@aicaa/db';
import {
  DEFAULT_GMAIL_EXCERPT_RETENTION_DAYS,
  measureExcerptByteLength,
  type TemporaryCommunicationExcerpt,
} from '@aicaa/domain';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { computeGoogleMessagesSourceDedupeDigest } from '@/lib/interpretation/fingerprint';
import type { GoogleMessagesInterpretationProvenance } from '@/lib/interpretation/validate';

/**
 * A Messages Review excerpt starts at Review + 7 days: the same seven-day initial maximum D078
 * fixes for Gmail ingest, anchored to the Owner Review that created it because Messages has no
 * ingest. It holds only until a committed workflow association grants a D082 entitlement (D181).
 */
const EXCERPT_RETENTION_MS = DEFAULT_GMAIL_EXCERPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface MessagesReviewSource {
  rawInput: string;
  capturedAt: string;
  provenance: GoogleMessagesInterpretationProvenance;
  /** True when selected text differs from the retained excerpt and should be written after a new run. */
  replaceExcerptAfterCommit: boolean;
}

function randomToken(): string {
  return randomBytes(12).toString('base64url');
}

function reviewTimePurgeAt(now: string): string {
  return new Date(Date.parse(now) + EXCERPT_RETENTION_MS).toISOString();
}

function isExcerptAvailable(
  excerpt: TemporaryCommunicationExcerpt | null,
  now: string,
): excerpt is TemporaryCommunicationExcerpt {
  if (!excerpt || excerpt.purgedAt != null || excerpt.content.length === 0) {
    return false;
  }
  return Date.parse(excerpt.purgeAt) > Date.parse(now);
}

/**
 * Prepare Messages Review identities without writing CommunicationEvent or excerpt rows.
 *
 * D161 classification uses `sourceOccurrenceId`, selected text, and `observedAt` — not these
 * generated ids — so replay and conflict can be decided before any selected text is persisted.
 */
export function prepareMessagesReviewSource(input: {
  organizationId: string;
  sourceOccurrenceId: string;
  selectedText: string;
  observedAt: string;
}): Pick<MessagesReviewSource, 'rawInput' | 'capturedAt' | 'provenance'> {
  const dedupeKey = computeGoogleMessagesSourceDedupeDigest({
    organizationId: input.organizationId,
    sourceOccurrenceId: input.sourceOccurrenceId,
  });
  return {
    rawInput: input.selectedText,
    capturedAt: input.observedAt,
    provenance: {
      communicationEventId: `cmsg_${randomToken()}`,
      sourceOccurrenceId: input.sourceOccurrenceId,
      excerptId: `exm_${randomToken()}`,
      excerptByteLength: measureExcerptByteLength(input.selectedText),
      dedupeKey,
    },
  };
}

async function createOrReuseEvent(
  db: DbClient,
  input: {
    organizationId: string;
    eventId: string;
    sourceOccurrenceId: string;
    observedAt: string;
    dedupeKey: string;
  },
) {
  const runtime = await loadDbRuntime();
  const created = await runtime.upsertGoogleMessagesReviewEvent(db, {
    organizationId: input.organizationId,
    eventId: input.eventId,
    sourceOccurrenceId: input.sourceOccurrenceId,
    dedupeKey: input.dedupeKey,
    observedAt: input.observedAt,
  });
  return created.event;
}

/**
 * Persist the canonical CommunicationEvent and TemporaryCommunicationExcerpt for an explicit
 * Owner Google Messages Review that D161 has already classified as new (D181).
 *
 * Selected text is persisted only on TemporaryCommunicationExcerpt. Event preview fields stay
 * empty. No CommunicationAccount is created. A6 is not invoked.
 *
 * An already-retained excerpt with different text is not overwritten until a new interpretation
 * commits, so a later provider failure cannot replace the prior selected text.
 */
export async function persistPreparedMessagesReviewSource(
  db: DbClient,
  input: {
    organizationId: string;
    sourceOccurrenceId: string;
    selectedText: string;
    observedAt: string;
    now: string;
    prepared: Pick<MessagesReviewSource, 'provenance'>;
  },
): Promise<MessagesReviewSource> {
  const runtime = await loadDbRuntime();
  const event = await createOrReuseEvent(db, {
    organizationId: input.organizationId,
    eventId: input.prepared.provenance.communicationEventId,
    sourceOccurrenceId: input.sourceOccurrenceId,
    observedAt: input.observedAt,
    dedupeKey: input.prepared.provenance.dedupeKey,
  });

  const currentExcerpt = await runtime.getTemporaryCommunicationExcerptByEventId(
    db,
    input.organizationId,
    event.id,
  );
  const existingExcerptId = currentExcerpt?.id;

  if (isExcerptAvailable(currentExcerpt, input.now)) {
    const sameText = currentExcerpt.content === input.selectedText;
    return {
      rawInput: input.selectedText,
      capturedAt: input.observedAt,
      replaceExcerptAfterCommit: !sameText,
      provenance: {
        communicationEventId: event.id,
        sourceOccurrenceId: input.sourceOccurrenceId,
        excerptId: currentExcerpt.id,
        excerptByteLength: measureExcerptByteLength(input.selectedText),
        dedupeKey: input.prepared.provenance.dedupeKey,
      },
    };
  }

  const excerpt = await runtime.upsertTemporaryCommunicationExcerpt(db, {
    organizationId: input.organizationId,
    communicationEventId: event.id,
    excerptId: existingExcerptId ?? input.prepared.provenance.excerptId,
    content: input.selectedText,
    purgeAt: reviewTimePurgeAt(input.now),
  });

  return {
    rawInput: input.selectedText,
    capturedAt: input.observedAt,
    replaceExcerptAfterCommit: false,
    provenance: {
      communicationEventId: event.id,
      sourceOccurrenceId: input.sourceOccurrenceId,
      excerptId: excerpt.id,
      excerptByteLength: excerpt.byteLength,
      dedupeKey: input.prepared.provenance.dedupeKey,
    },
  };
}

/**
 * Replace the retained selected text after a new interpretation committed.
 *
 * Content replacement is not a workflow transition, so it must not shorten the excerpt's deadline
 * (D082). The occurrence that just committed may have established an `associatedAt + 30 days` hold
 * for its proposals, and rewriting the text back down to Review + 7 days would drop a hold those
 * proposals still need. The later of the two deadlines is kept; the entitlement itself is only ever
 * computed by the shared retention resolver inside a lifecycle transaction.
 */
export async function persistMessagesReviewExcerpt(
  db: DbClient,
  input: {
    organizationId: string;
    communicationEventId: string;
    excerptId: string;
    selectedText: string;
    now: string;
  },
): Promise<void> {
  const runtime = await loadDbRuntime();
  const current = await runtime.getTemporaryCommunicationExcerptByEventId(
    db,
    input.organizationId,
    input.communicationEventId,
  );
  const reviewDeadline = reviewTimePurgeAt(input.now);
  const heldDeadline = current?.purgeAt;

  await runtime.upsertTemporaryCommunicationExcerpt(db, {
    organizationId: input.organizationId,
    communicationEventId: input.communicationEventId,
    excerptId: input.excerptId,
    content: input.selectedText,
    purgeAt:
      heldDeadline && Date.parse(heldDeadline) > Date.parse(reviewDeadline)
        ? heldDeadline
        : reviewDeadline,
  });
}
