import 'server-only';
import type { CreateAuditEventInput, DbClient } from '@aicaa/db';
import { randomBytes } from 'node:crypto';
import type { OwnerActor } from '@aicaa/domain';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { GmailRequestError } from './errors';
import { gmailSenderExclusionKey } from './normalize';

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export type OwnerGmailExclusionContext = {
  owner: OwnerActor;
  db: DbClient;
  now: string;
  requestId: string;
};

export type GmailSenderExclusionDto = {
  id: string;
  createdAt: string;
};

function ownerExclusionAudit(input: {
  action: 'gmail_sender_excluded' | 'gmail_sender_exclusion_removed';
  organizationId: string;
  ownerId: string;
  communicationEventId?: string;
  now: string;
  requestId: string;
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'owner',
    ownerId: input.ownerId,
    communicationEventId: input.communicationEventId,
    action: input.action,
    outcome: 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
  };
}

export async function isGmailSenderExcludedForNewInterpretation(
  ctx: Pick<OwnerGmailExclusionContext, 'owner' | 'db'>,
  fromAddress: string,
): Promise<boolean> {
  const key = gmailSenderExclusionKey(fromAddress);
  if (key == null) {
    return false;
  }
  const runtime = await loadDbRuntime();
  const existing = await runtime.findGmailSenderExclusionByOrgAndAddress(
    ctx.db,
    ctx.owner.organizationId,
    key,
  );
  return existing != null;
}

/**
 * Create (or idempotently return) an organization-scoped Gmail sender exclusion from an A5 event.
 *
 * The exclusion key is the existing Gmail-ingestion normalized From address. The unparseable-From
 * sentinel is refused so one malformed sender cannot exclude every other malformed sender (D180).
 */
export async function excludeGmailSenderFromEvent(
  ctx: OwnerGmailExclusionContext,
  communicationEventId: string,
): Promise<GmailSenderExclusionDto> {
  const runtime = await loadDbRuntime();
  let event;
  try {
    event = await runtime.getCommunicationEventById(
      ctx.db,
      ctx.owner.organizationId,
      communicationEventId,
    );
  } catch (error) {
    if (runtime.isPersistenceError(error) && error.code === 'NOT_FOUND') {
      throw new GmailRequestError('not_found', 'Gmail message was not found.');
    }
    throw error;
  }

  if (event.sourceType !== 'gmail') {
    throw new GmailRequestError('not_found', 'Gmail message was not found.');
  }

  const senderAddress = gmailSenderExclusionKey(event.fromAddress);
  if (senderAddress == null) {
    throw new GmailRequestError(
      'validation',
      'This Gmail sender cannot be excluded because the From address is missing or unparseable.',
    );
  }

  const result = await runtime.persistGmailSenderExclusion({
    db: ctx.db,
    exclusion: {
      id: newId('gsex'),
      organizationId: ctx.owner.organizationId,
      senderAddress,
      createdByOwnerId: ctx.owner.ownerId,
    },
    audit: ownerExclusionAudit({
      action: 'gmail_sender_excluded',
      organizationId: ctx.owner.organizationId,
      ownerId: ctx.owner.ownerId,
      communicationEventId: event.id,
      now: ctx.now,
      requestId: ctx.requestId,
    }),
  });

  return { id: result.exclusion.id, createdAt: result.exclusion.createdAt };
}

export async function removeGmailSenderExclusion(
  ctx: OwnerGmailExclusionContext,
  exclusionId: string,
): Promise<GmailSenderExclusionDto> {
  const runtime = await loadDbRuntime();
  try {
    const exclusion = await runtime.removeGmailSenderExclusion({
      db: ctx.db,
      organizationId: ctx.owner.organizationId,
      exclusionId,
      audit: ownerExclusionAudit({
        action: 'gmail_sender_exclusion_removed',
        organizationId: ctx.owner.organizationId,
        ownerId: ctx.owner.ownerId,
        now: ctx.now,
        requestId: ctx.requestId,
      }),
    });
    return { id: exclusion.id, createdAt: exclusion.createdAt };
  } catch (error) {
    if (runtime.isPersistenceError(error) && error.code === 'NOT_FOUND') {
      throw new GmailRequestError('not_found', 'Gmail sender exclusion was not found.');
    }
    throw error;
  }
}
