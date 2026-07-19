import type { Actor } from '../types/actor.js';
import { isOwner } from '../types/actor.js';
import type { Task } from '../entities/task.js';
import { isTerminalTaskStatus } from '../entities/task.js';
import type { Recipient } from '../entities/recipient.js';
import type { OrganizationId, RecipientId } from '../types/ids.js';
import { assertMatchingPrecondition } from '../concurrency/etag.js';
import { parseHandoffAcknowledgement } from './acknowledgement.js';
import { selectHandoffDeliveryPath, rejectClientDeliveryPathOverride } from './delivery-path.js';
import { evaluateRecipientForHandoff } from './recipient-rules.js';
import {
  evaluateGmailHandoffPrerequisites,
  type GmailConnectionFacts,
} from './gmail-prerequisites.js';
import type {
  HandoffAcknowledgement,
  HandoffAttempt,
  HandoffDeliveryPath,
  HandoffMode,
} from './types.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';

export type HandoffIntentMode =
  'initial' | 'idempotent_replay' | 'retry_failed' | 'explicit_reforward' | 'reassignment';

export interface HandoffEligibilityInput {
  actor: Actor;
  task: Task | null | undefined;
  /** Owner organization expected for the Task (from session). */
  ownerOrganizationId: OrganizationId;
  recipient: Recipient | null | undefined;
  recipientOrganizationId?: OrganizationId;
  recipientId: RecipientId;
  acknowledgement: unknown;
  ifMatch: string | undefined;
  /**
   * When true, Task is Owner/self-only work and must not receive Recipient handoff (D094).
   * Supplied by application from product intent — not inferred from absence of Recipient.
   */
  ownerSelfWorkOnly?: boolean;
  /**
   * Existing incomplete/conflicting handoff attempt facts (looked up by application).
   * Domain does not query persistence.
   */
  existingAttempts?: {
    /** Pending attempt for this Task (any key) that would conflict with a new initial handoff. */
    pendingForTask?: HandoffAttempt | null;
    /** Completed successful handoff already exists for this Task. */
    completedSentForTask?: HandoffAttempt | null;
    /** Attempt matched to the current idempotency key, if any. */
    forIdempotencyKey?: HandoffAttempt | null;
  };
  gmailConnection: GmailConnectionFacts;
  /** Optional client field that must be absent. */
  clientDeliveryPath?: unknown;
  /**
   * Requested semantic mode. Default `initial` requires an unassigned Task.
   * Explicit re-forward / reassignment / retry are evaluated separately.
   */
  intentMode?: HandoffIntentMode;
}

export interface HandoffEligibilityOk {
  task: Task;
  recipient: Recipient;
  acknowledgement: HandoffAcknowledgement;
  deliveryPath: HandoffDeliveryPath;
  intentMode: HandoffIntentMode;
}

function assertOwnerActor(actor: Actor): HandoffResult<void> {
  if (!isOwner(actor)) {
    return handoffFail(
      'FORBIDDEN',
      categoryForHandoffCode('FORBIDDEN'),
      'Only the Task Owner may confirm handoff.',
    );
  }
  return handoffOk(undefined);
}

/**
 * Pure handoff eligibility (D037, D080, D086–D094).
 * Accepts validated domain inputs — does not perform DB ownership lookup or ETag fetch.
 */
export function evaluateHandoffEligibility(
  input: HandoffEligibilityInput,
): HandoffResult<HandoffEligibilityOk> {
  const intentMode = input.intentMode ?? 'initial';

  const actorCheck = assertOwnerActor(input.actor);
  if (!actorCheck.ok) {
    return actorCheck;
  }
  if (!isOwner(input.actor)) {
    return handoffFail('FORBIDDEN', 'authorization', 'Only the Task Owner may confirm handoff.');
  }

  const pathOverride = rejectClientDeliveryPathOverride(input.clientDeliveryPath);
  if (!pathOverride.ok) {
    return pathOverride;
  }

  const ack = parseHandoffAcknowledgement(input.acknowledgement);
  if (!ack.ok) {
    return ack;
  }

  if (!input.task) {
    return handoffFail('NOT_FOUND', categoryForHandoffCode('NOT_FOUND'), 'Task was not found.');
  }
  const task = input.task;

  if (task.organizationId !== input.ownerOrganizationId) {
    return handoffFail(
      'NOT_FOUND',
      categoryForHandoffCode('NOT_FOUND'),
      'Task was not found in the Owner organization.',
    );
  }

  if (input.actor.organizationId !== input.ownerOrganizationId) {
    return handoffFail(
      'FORBIDDEN',
      categoryForHandoffCode('FORBIDDEN'),
      'Authenticated Owner does not belong to the Task organization.',
    );
  }

  if (input.ownerSelfWorkOnly) {
    return handoffFail(
      'HANDOFF_NOT_ELIGIBLE',
      categoryForHandoffCode('HANDOFF_NOT_ELIGIBLE'),
      'Owner/self-only work cannot be handed off to a Recipient.',
    );
  }

  if (isTerminalTaskStatus(task.status)) {
    return handoffFail(
      'HANDOFF_NOT_ELIGIBLE',
      categoryForHandoffCode('HANDOFF_NOT_ELIGIBLE'),
      'Terminal Tasks cannot enter handoff.',
    );
  }

  try {
    assertMatchingPrecondition(input.ifMatch, {
      kind: 'task',
      resourceId: task.id,
      version: task.version,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Concurrency precondition failed.';
    const code =
      message.includes('required') || message.includes('Required')
        ? ('PRECONDITION_REQUIRED' as const)
        : ('PRECONDITION_FAILED' as const);
    return handoffFail(code, categoryForHandoffCode(code), message);
  }

  if (!input.recipient || !input.recipientOrganizationId) {
    return handoffFail(
      'NOT_FOUND',
      categoryForHandoffCode('NOT_FOUND'),
      'Recipient was not found.',
    );
  }

  if (input.recipient.id !== input.recipientId) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'recipientId does not match the supplied Recipient.',
      [{ field: 'recipientId', message: 'Mismatch' }],
    );
  }

  const recipientOk = evaluateRecipientForHandoff({
    recipient: input.recipient,
    recipientOrganizationId: input.recipientOrganizationId,
    ownerOrganizationId: input.ownerOrganizationId,
  });
  if (!recipientOk.ok) {
    return recipientOk;
  }

  // Assignment / attempt state rules by intent
  const pending = input.existingAttempts?.pendingForTask;
  const completed = input.existingAttempts?.completedSentForTask;
  const keyed = input.existingAttempts?.forIdempotencyKey;

  if (intentMode === 'initial') {
    if (task.assignment) {
      return handoffFail(
        'DOMAIN_CONFLICT',
        categoryForHandoffCode('DOMAIN_CONFLICT'),
        'Task is already assigned; use reassignment or explicit re-forward.',
      );
    }
    if (pending && (!keyed || pending.id !== keyed.id)) {
      return handoffFail(
        'HANDOFF_IN_PROGRESS',
        categoryForHandoffCode('HANDOFF_IN_PROGRESS'),
        'A handoff attempt is already in progress for this Task.',
      );
    }
    if (completed && !(keyed && keyed.status === 'sent' && keyed.id === completed.id)) {
      return handoffFail(
        'DOMAIN_CONFLICT',
        categoryForHandoffCode('DOMAIN_CONFLICT'),
        'A completed handoff already exists unless this is a valid idempotent replay.',
      );
    }
  }

  if (intentMode === 'retry_failed') {
    if (!keyed || keyed.status !== 'failed') {
      return handoffFail(
        'HANDOFF_NOT_ELIGIBLE',
        categoryForHandoffCode('HANDOFF_NOT_ELIGIBLE'),
        'Failed-attempt retry requires a matching failed handoff attempt.',
      );
    }
    if (keyed.recipientId !== input.recipientId) {
      return handoffFail(
        'IDEMPOTENCY_KEY_CONFLICT',
        categoryForHandoffCode('IDEMPOTENCY_KEY_CONFLICT'),
        'Retry must use the same Recipient as the failed attempt.',
      );
    }
  }

  if (intentMode === 'explicit_reforward') {
    if (!completed || completed.status !== 'sent') {
      return handoffFail(
        'HANDOFF_NOT_ELIGIBLE',
        categoryForHandoffCode('HANDOFF_NOT_ELIGIBLE'),
        'Explicit re-forward requires a prior successful send.',
      );
    }
  }

  if (intentMode === 'reassignment') {
    if (!task.assignment) {
      return handoffFail(
        'HANDOFF_NOT_ELIGIBLE',
        categoryForHandoffCode('HANDOFF_NOT_ELIGIBLE'),
        'Reassignment requires an existing Assignment.',
      );
    }
    if (task.assignment.recipientId === input.recipientId) {
      return handoffFail(
        'VALIDATION_ERROR',
        categoryForHandoffCode('VALIDATION_ERROR'),
        'Reassignment requires a different Recipient.',
        [{ field: 'recipientId', message: 'Must differ from current Assignment' }],
      );
    }
  }

  const deliveryPath = selectHandoffDeliveryPath(task.sourceReference);
  const gmail = evaluateGmailHandoffPrerequisites({
    deliveryPath,
    connection: input.gmailConnection,
    sourceReference: task.sourceReference,
  });
  if (!gmail.ok) {
    return gmail;
  }

  return handoffOk({
    task,
    recipient: recipientOk.value,
    acknowledgement: ack.value,
    deliveryPath,
    intentMode,
  });
}

/** Map intent mode to lifecycle handoff mode when starting work. */
export function intentModeToHandoffMode(intent: HandoffIntentMode): HandoffMode {
  switch (intent) {
    case 'initial':
      return 'new_attempt';
    case 'idempotent_replay':
      return 'replay_sent';
    case 'retry_failed':
      return 'retry_failed';
    case 'explicit_reforward':
      return 'explicit_reforward';
    case 'reassignment':
      return 'reassignment';
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}
