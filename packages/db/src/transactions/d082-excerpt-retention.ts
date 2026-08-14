import {
  resolveExcerptPurgeAt,
  type ExcerptEntitlementHolder,
} from '../../../domain/dist/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { fromIso, toIso } from '../mappers/domain-mappers.js';

type Client = DbClient | DbTransaction;

/**
 * Which excerpt a lifecycle transition is about, named the way its proposal actually links to it.
 *
 * A6 knows its CommunicationEvent and nothing about excerpt identity; Owner Review knows the
 * excerpt directly. Both reach one row, because a CommunicationEvent has at most one excerpt.
 */
export type ExcerptRetentionTarget =
  | { kind: 'communication_event'; communicationEventId: string }
  | { kind: 'excerpt'; excerptId: string };

/** The two linkage columns a TaskSuggestion may carry, as persistence reads them. */
export type ExcerptRetentionLinkage = {
  sourceCommunicationEventId?: string | null;
  sourceExcerptId?: string | null;
};

/**
 * The excerpt a proposal holds an entitlement on, or null when it holds none.
 *
 * The Review linkage is preferred when both are somehow present, because it names the excerpt
 * directly. In practice they are mutually exclusive: shared interpretation refuses to populate
 * `sourceCommunicationEventId`, and A6 does not populate `sourceExcerptId`.
 */
export function excerptRetentionTargetFor(
  linkage: ExcerptRetentionLinkage,
): ExcerptRetentionTarget | null {
  if (linkage.sourceExcerptId) {
    return { kind: 'excerpt', excerptId: linkage.sourceExcerptId };
  }
  if (linkage.sourceCommunicationEventId) {
    return {
      kind: 'communication_event',
      communicationEventId: linkage.sourceCommunicationEventId,
    };
  }
  return null;
}

/** An entitlement the transition in flight has already computed for one of its own proposals. */
export type TransitionEntitlement = { suggestionId: string; purgeAt: string };

type LockedExcerpt = { id: string; communicationEventId: string };

/**
 * Lock the excerpt row before its siblings are read.
 *
 * Without the lock, two sibling transitions could each read the other as untransitioned and the
 * second writer would commit an aggregate computed from state its own commit invalidated. Taking the
 * row lock first makes the loser block until the winner commits and then read the winner's work, so
 * the aggregate it writes accounts for both. Purged excerpts are excluded here rather than later:
 * there is nothing to serialize on an excerpt that will not be written.
 */
async function lockUnpurgedExcerpt(
  db: Client,
  organizationId: string,
  target: ExcerptRetentionTarget,
): Promise<LockedExcerpt | null> {
  const rows =
    target.kind === 'excerpt'
      ? await db.$queryRaw<Array<{ id: string; communication_event_id: string }>>`
          SELECT id, communication_event_id
          FROM temporary_communication_excerpts
          WHERE id = ${target.excerptId}
            AND organization_id = ${organizationId}
            AND purged_at IS NULL
          FOR UPDATE
        `
      : await db.$queryRaw<Array<{ id: string; communication_event_id: string }>>`
          SELECT id, communication_event_id
          FROM temporary_communication_excerpts
          WHERE communication_event_id = ${target.communicationEventId}
            AND organization_id = ${organizationId}
            AND purged_at IS NULL
          FOR UPDATE
        `;

  const row = rows[0];
  return row ? { id: row.id, communicationEventId: row.communication_event_id } : null;
}

/**
 * Every proposal holding a D082 claim on one excerpt, through either linkage (D082, D161).
 *
 * The `OR` is the whole point of the shared resolver: a Gmail message may carry both a legacy A6
 * suggestion and later Owner Review proposals, and the excerpt owes its existence to the longest
 * claim among all of them regardless of which column expressed it.
 */
async function readEntitlementHolders(
  db: Client,
  organizationId: string,
  excerpt: LockedExcerpt,
): Promise<ExcerptEntitlementHolder[]> {
  const rows = await db.taskSuggestion.findMany({
    where: {
      organizationId,
      OR: [
        { sourceCommunicationEventId: excerpt.communicationEventId },
        { sourceExcerptId: excerpt.id },
      ],
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      approvedTask: { select: { status: true, createdAt: true, updatedAt: true } },
    },
  });

  return rows.map((row) => {
    const task = row.approvedTask;
    const taskIsTerminal = task?.status === 'completed' || task?.status === 'dismissed';
    return {
      suggestionId: row.id,
      status: row.status,
      // The association instant is the proposal's own creation: that is the write that made this
      // excerpt evidence for a workflow. No separate associated_at column exists or is needed.
      associatedAt: toIso(row.createdAt),
      suggestionTerminalAt:
        row.status === 'dismissed' || row.status === 'merged' ? toIso(row.updatedAt) : null,
      approvedAt: task ? toIso(task.createdAt) : null,
      taskTerminalAt: task && taskIsTerminal ? toIso(task.updatedAt) : null,
    };
  });
}

/**
 * Apply the D082 excerpt deadline for one excerpt from the maximum still-valid sibling entitlement.
 *
 * Must be called **inside** the transaction that performs the lifecycle mutation it corresponds to
 * (D082 atomicity): the row lock it takes is only meaningful for that transaction's duration, and a
 * retention change that committed separately from the transition that justified it would be exactly
 * the eventual-reconciliation design D082 refuses.
 *
 * Returns false, having written nothing, when the excerpt is missing, already purged, or claimed by
 * nothing. A purged excerpt is never restored and never re-dated (D082, D024). No entitlement means
 * the excerpt keeps its initial ingest or Review deadline — silence, not a hold.
 */
export async function applyD082ExcerptRetention(
  db: Client,
  organizationId: string,
  input: {
    target: ExcerptRetentionTarget;
    /** Entitlements this transition computed itself, taking precedence over derived values. */
    transitionEntitlements?: readonly TransitionEntitlement[];
  },
): Promise<boolean> {
  const excerpt = await lockUnpurgedExcerpt(db, organizationId, input.target);
  if (!excerpt) {
    return false;
  }

  const holders = await readEntitlementHolders(db, organizationId, excerpt);
  const purgeAt = resolveExcerptPurgeAt({
    holders,
    transitionEntitlements: new Map(
      (input.transitionEntitlements ?? []).map((entry) => [entry.suggestionId, entry.purgeAt]),
    ),
  });
  if (!purgeAt) {
    return false;
  }

  const result = await db.temporaryCommunicationExcerpt.updateMany({
    where: { id: excerpt.id, organizationId, purgedAt: null },
    data: { purgeAt: fromIso(purgeAt)! },
  });
  return result.count === 1;
}

/**
 * Apply D082 retention for whichever excerpt a proposal is linked to, if any.
 *
 * The single entry point every lifecycle transaction uses, so no caller has to know that two
 * linkage columns exist or which one its source populates.
 */
export async function applyD082ExcerptRetentionForSuggestion(
  db: Client,
  organizationId: string,
  suggestion: ExcerptRetentionLinkage & { id: string },
  entitlementPurgeAt: string,
): Promise<boolean> {
  const target = excerptRetentionTargetFor(suggestion);
  if (!target) {
    return false;
  }
  return applyD082ExcerptRetention(db, organizationId, {
    target,
    transitionEntitlements: [{ suggestionId: suggestion.id, purgeAt: entitlementPurgeAt }],
  });
}
