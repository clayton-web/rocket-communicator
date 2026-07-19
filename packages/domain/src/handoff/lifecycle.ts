import type {
  AssignmentId,
  CapabilityId,
  OrganizationId,
  OwnerId,
  RecipientId,
  TaskId,
} from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { Task } from '../entities/task.js';
import type { Recipient } from '../entities/recipient.js';
import type { TaskAssignment } from '../value-objects/task-assignment.js';
import type { TaskCapability } from '../value-objects/capability.js';
import { DEFAULT_RECIPIENT_CAPABILITY_SCOPE } from '../value-objects/capability.js';
import { revokeCapability } from '../state-machines/capability.lifecycle.js';
import { isRecipientHandoffCapabilityActionable } from './capability-access.js';
import { categoryForHandoffCode, handoffFail, handoffOk, type HandoffResult } from './failures.js';
import type {
  HandoffAcknowledgement,
  HandoffAttempt,
  HandoffAuditIntent,
  HandoffDeliveryPath,
  HandoffMode,
} from './types.js';

/**
 * Conceptual effects for application/persistence to apply. Domain does not pretend
 * these have already occurred (D092).
 */
export type HandoffEffect =
  | {
      type: 'create_attempt';
      attempt: Omit<HandoffAttempt, 'updatedAt'> & { updatedAt?: UtcInstant };
    }
  | { type: 'reuse_attempt'; attemptId: string }
  | {
      type: 'create_pending_assignment';
      assignment: TaskAssignment;
    }
  | {
      type: 'revise_assignment_recipient';
      assignmentId: AssignmentId;
      recipientId: RecipientId;
      intendedRecipientEmail: string;
    }
  | {
      type: 'issue_capability';
      capability: TaskCapability;
      /** False until delivery is `sent`. */
      actionable: false;
    }
  | { type: 'reuse_capability'; capabilityId: CapabilityId; actionable: false }
  | {
      type: 'supersede_capability';
      capability: TaskCapability;
      priorCapabilityId: CapabilityId;
    }
  | { type: 'preflight_gmail_forward' }
  | { type: 'attempt_delivery'; deliveryPath: HandoffDeliveryPath }
  | {
      type: 'mark_attempt_sent';
      attemptId: string;
      providerMessageId: string;
    }
  | { type: 'mark_attempt_failed'; attemptId: string }
  | {
      type: 'activate_assignment';
      assignmentId: AssignmentId;
      deliveryStatus: 'sent';
    }
  | {
      type: 'activate_capability';
      capabilityId: CapabilityId;
      /** Becomes actionable only with sent delivery. */
      actionable: true;
    }
  | { type: 'replay_success'; attemptId: string; idempotentReplay: true }
  | { type: 'replay_in_progress'; attemptId: string };

export interface HandoffTransitionPlan {
  mode: HandoffMode;
  deliveryPath: HandoffDeliveryPath;
  effects: HandoffEffect[];
  auditIntents: HandoffAuditIntent[];
  /**
   * True when this plan describes a successful send outcome conceptually.
   * Does not imply Recipient read/open.
   */
  impliesRecipientRead: false;
}

export interface PlanNewHandoffAttemptInput {
  now: UtcInstant;
  attemptId: string;
  assignmentId: AssignmentId;
  capabilityId: CapabilityId;
  task: Task;
  recipient: Recipient;
  ownerId: OwnerId;
  organizationId: OrganizationId;
  acknowledgement: HandoffAcknowledgement;
  deliveryPath: HandoffDeliveryPath;
  idempotencyKey: string;
  requestFingerprint: string;
  capabilityExpiresAt: UtcInstant;
}

/**
 * Plan creation of a new handoff attempt: pending assignment + non-actionable capability
 * + delivery attempt effects. Activation happens only after send acceptance.
 */
export function planNewHandoffAttempt(input: PlanNewHandoffAttemptInput): HandoffTransitionPlan {
  const assignment: TaskAssignment = {
    id: input.assignmentId,
    recipientId: input.recipient.id,
    intendedRecipientEmail: input.recipient.email,
    assignedAt: input.now,
    assignedByOwnerId: input.ownerId,
    allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    capabilityStatus: 'active',
    deliveryStatus: 'pending',
    activeCapabilityId: input.capabilityId,
  };

  const capability: TaskCapability = {
    id: input.capabilityId,
    taskId: input.task.id,
    assignmentId: input.assignmentId,
    recipientId: input.recipient.id,
    intendedRecipientEmail: input.recipient.email,
    scope: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    status: 'active',
    issuedAt: input.now,
    expiresAt: input.capabilityExpiresAt,
    revokedAt: null,
  };

  const attempt: HandoffAttempt = {
    id: input.attemptId,
    taskId: input.task.id,
    organizationId: input.organizationId,
    recipientId: input.recipient.id,
    acknowledgement: input.acknowledgement,
    deliveryPath: input.deliveryPath,
    status: 'pending',
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    capabilityId: input.capabilityId,
    assignmentId: input.assignmentId,
    providerMessageId: null,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const effects: HandoffEffect[] = [
    { type: 'create_attempt', attempt },
    { type: 'create_pending_assignment', assignment },
    { type: 'issue_capability', capability, actionable: false },
  ];
  if (input.deliveryPath === 'gmail_forward') {
    effects.push({ type: 'preflight_gmail_forward' });
  }
  effects.push({ type: 'attempt_delivery', deliveryPath: input.deliveryPath });

  const auditIntents: HandoffAuditIntent[] = [
    {
      type: 'handoff_confirmed',
      organizationId: input.organizationId,
      taskId: input.task.id,
      recipientId: input.recipient.id,
      deliveryPath: input.deliveryPath,
      occurredAt: input.now,
    },
    {
      type: 'handoff_attempt_created',
      organizationId: input.organizationId,
      taskId: input.task.id,
      recipientId: input.recipient.id,
      attemptId: input.attemptId,
      capabilityId: input.capabilityId,
      deliveryPath: input.deliveryPath,
      occurredAt: input.now,
    },
  ];

  return {
    mode: 'new_attempt',
    deliveryPath: input.deliveryPath,
    effects,
    auditIntents,
    impliesRecipientRead: false,
  };
}

/**
 * Failed retry reuses the same attempt and capability when security-sensitive inputs
 * are unchanged (D086, D092). Does not silently become a re-forward.
 */
export function planFailedAttemptRetry(input: {
  now: UtcInstant;
  attempt: HandoffAttempt;
  organizationId: OrganizationId;
}): HandoffResult<HandoffTransitionPlan> {
  if (input.attempt.status !== 'failed') {
    return handoffFail(
      'INVALID_STATE_TRANSITION',
      categoryForHandoffCode('INVALID_STATE_TRANSITION'),
      'Only failed handoff attempts can be retried in place.',
    );
  }
  if (input.attempt.providerMessageId) {
    return handoffFail(
      'DOMAIN_CONFLICT',
      categoryForHandoffCode('DOMAIN_CONFLICT'),
      'Attempt already has a provider message id; use explicit re-forward instead of retry.',
    );
  }

  const effects: HandoffEffect[] = [{ type: 'reuse_attempt', attemptId: input.attempt.id }];
  if (input.attempt.capabilityId) {
    effects.push({
      type: 'reuse_capability',
      capabilityId: input.attempt.capabilityId,
      actionable: false,
    });
  }
  if (input.attempt.deliveryPath === 'gmail_forward') {
    effects.push({ type: 'preflight_gmail_forward' });
  }
  effects.push({
    type: 'attempt_delivery',
    deliveryPath: input.attempt.deliveryPath,
  });

  return handoffOk({
    mode: 'retry_failed',
    deliveryPath: input.attempt.deliveryPath,
    effects,
    auditIntents: [
      {
        type: 'retry_requested',
        organizationId: input.organizationId,
        taskId: input.attempt.taskId,
        recipientId: input.attempt.recipientId,
        attemptId: input.attempt.id,
        capabilityId: input.attempt.capabilityId,
        deliveryPath: input.attempt.deliveryPath,
        occurredAt: input.now,
      },
    ],
    impliesRecipientRead: false,
  });
}

/**
 * Explicit re-forward after a prior successful send: supersede prior capability,
 * create new attempt + capability. Duplicate delivery is intentional and audited.
 */
export function planExplicitReforward(input: {
  now: UtcInstant;
  priorAttempt: HandoffAttempt;
  priorCapability: TaskCapability;
  newAttempt: PlanNewHandoffAttemptInput;
}): HandoffResult<HandoffTransitionPlan> {
  if (input.priorAttempt.status !== 'sent') {
    return handoffFail(
      'INVALID_STATE_TRANSITION',
      categoryForHandoffCode('INVALID_STATE_TRANSITION'),
      'Explicit re-forward requires a prior successful send.',
    );
  }

  const superseded = revokeCapability(input.priorCapability, input.now, 'superseded');
  const base = planNewHandoffAttempt(input.newAttempt);

  return handoffOk({
    ...base,
    mode: 'explicit_reforward',
    effects: [
      {
        type: 'supersede_capability',
        capability: superseded,
        priorCapabilityId: input.priorCapability.id,
      },
      ...base.effects,
    ],
    auditIntents: [
      {
        type: 'explicit_reforward_requested',
        organizationId: input.newAttempt.organizationId,
        taskId: input.newAttempt.task.id,
        recipientId: input.newAttempt.recipient.id,
        occurredAt: input.now,
      },
      {
        type: 'capability_superseded',
        organizationId: input.newAttempt.organizationId,
        taskId: input.newAttempt.task.id,
        capabilityId: input.priorCapability.id,
        revocationReason: 'superseded',
        occurredAt: input.now,
      },
      ...base.auditIntents,
    ],
    impliesRecipientRead: false,
  });
}

/**
 * Reassignment: Recipient changes; prior active capability superseded; new attempt/capability.
 */
export function planReassignment(input: {
  now: UtcInstant;
  priorCapability: TaskCapability;
  newAttempt: PlanNewHandoffAttemptInput;
}): HandoffTransitionPlan {
  const superseded = revokeCapability(input.priorCapability, input.now, 'superseded');
  const base = planNewHandoffAttempt(input.newAttempt);

  const revise: HandoffEffect = {
    type: 'revise_assignment_recipient',
    assignmentId: input.newAttempt.assignmentId,
    recipientId: input.newAttempt.recipient.id,
    intendedRecipientEmail: input.newAttempt.recipient.email,
  };

  return {
    ...base,
    mode: 'reassignment',
    effects: [
      {
        type: 'supersede_capability',
        capability: superseded,
        priorCapabilityId: input.priorCapability.id,
      },
      revise,
      ...base.effects.filter((e) => e.type !== 'create_pending_assignment'),
    ],
    auditIntents: [
      {
        type: 'reassignment_requested',
        organizationId: input.newAttempt.organizationId,
        taskId: input.newAttempt.task.id,
        recipientId: input.newAttempt.recipient.id,
        occurredAt: input.now,
      },
      {
        type: 'capability_superseded',
        organizationId: input.newAttempt.organizationId,
        taskId: input.newAttempt.task.id,
        capabilityId: input.priorCapability.id,
        revocationReason: 'superseded',
        occurredAt: input.now,
      },
      ...base.auditIntents,
    ],
    impliesRecipientRead: false,
  };
}

/**
 * Gmail accepted outbound send → mark attempt sent, activate Assignment + capability.
 * Does not imply Recipient read/open.
 */
export function planDeliveryAccepted(input: {
  now: UtcInstant;
  attempt: HandoffAttempt;
  assignmentId: AssignmentId;
  capabilityId: CapabilityId;
  providerMessageId: string;
  organizationId: OrganizationId;
}): HandoffResult<HandoffTransitionPlan> {
  if (input.attempt.status === 'sent') {
    return handoffOk({
      mode: 'replay_sent',
      deliveryPath: input.attempt.deliveryPath,
      effects: [
        {
          type: 'replay_success',
          attemptId: input.attempt.id,
          idempotentReplay: true,
        },
      ],
      auditIntents: [],
      impliesRecipientRead: false,
    });
  }
  if (input.attempt.status !== 'pending' && input.attempt.status !== 'failed') {
    return handoffFail(
      'INVALID_STATE_TRANSITION',
      categoryForHandoffCode('INVALID_STATE_TRANSITION'),
      'Only pending or failed attempts can transition to sent.',
    );
  }
  if (!input.providerMessageId.trim()) {
    return handoffFail(
      'VALIDATION_ERROR',
      categoryForHandoffCode('VALIDATION_ERROR'),
      'Provider message id is required when Gmail accepts send.',
    );
  }

  return handoffOk({
    mode: input.attempt.status === 'failed' ? 'retry_failed' : 'new_attempt',
    deliveryPath: input.attempt.deliveryPath,
    effects: [
      {
        type: 'mark_attempt_sent',
        attemptId: input.attempt.id,
        providerMessageId: input.providerMessageId,
      },
      {
        type: 'activate_assignment',
        assignmentId: input.assignmentId,
        deliveryStatus: 'sent',
      },
      {
        type: 'activate_capability',
        capabilityId: input.capabilityId,
        actionable: true,
      },
    ],
    auditIntents: [
      {
        type: 'delivery_accepted',
        organizationId: input.organizationId,
        taskId: input.attempt.taskId,
        recipientId: input.attempt.recipientId,
        attemptId: input.attempt.id,
        capabilityId: input.capabilityId,
        deliveryPath: input.attempt.deliveryPath,
        providerMessageId: input.providerMessageId,
        occurredAt: input.now,
      },
    ],
    impliesRecipientRead: false,
  });
}

export function planDeliveryFailed(input: {
  now: UtcInstant;
  attempt: HandoffAttempt;
  organizationId: OrganizationId;
}): HandoffResult<HandoffTransitionPlan> {
  if (input.attempt.status === 'sent') {
    return handoffFail(
      'INVALID_STATE_TRANSITION',
      categoryForHandoffCode('INVALID_STATE_TRANSITION'),
      'A sent handoff cannot transition to failed.',
    );
  }

  return handoffOk({
    mode: 'retry_failed',
    deliveryPath: input.attempt.deliveryPath,
    effects: [{ type: 'mark_attempt_failed', attemptId: input.attempt.id }],
    auditIntents: [
      {
        type: 'delivery_failed',
        organizationId: input.organizationId,
        taskId: input.attempt.taskId,
        recipientId: input.attempt.recipientId,
        attemptId: input.attempt.id,
        capabilityId: input.attempt.capabilityId,
        deliveryPath: input.attempt.deliveryPath,
        occurredAt: input.now,
      },
    ],
    impliesRecipientRead: false,
  });
}

export function planIdempotentPendingReplay(input: {
  attempt: HandoffAttempt;
}): HandoffTransitionPlan {
  return {
    mode: 'replay_pending',
    deliveryPath: input.attempt.deliveryPath,
    effects: [{ type: 'replay_in_progress', attemptId: input.attempt.id }],
    auditIntents: [],
    impliesRecipientRead: false,
  };
}

export function planIdempotentSentReplay(input: {
  attempt: HandoffAttempt;
}): HandoffTransitionPlan {
  return {
    mode: 'replay_sent',
    deliveryPath: input.attempt.deliveryPath,
    effects: [
      {
        type: 'replay_success',
        attemptId: input.attempt.id,
        idempotentReplay: true,
      },
    ],
    auditIntents: [],
    impliesRecipientRead: false,
  };
}

/**
 * After send acceptance, capability+assignment become actionable together.
 */
export function assertSentActivatesCapability(input: {
  deliveryStatus: 'sent';
  capability: TaskCapability;
  now: UtcInstant;
}): boolean {
  return isRecipientHandoffCapabilityActionable({
    capability: input.capability,
    deliveryStatus: input.deliveryStatus,
    now: input.now,
  });
}

export type { TaskId };
