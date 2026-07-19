import { describe, expect, it } from 'vitest';
import {
  asAssignmentId,
  asCapabilityId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  assertCreateTaskRejectsRecipientId,
  assertHandoffAuditIntentIsPrivacySafe,
  assertNoDeliveryPathFallbackOnForwardFailure,
  computeHandoffRequestFingerprint,
  evaluateGmailHandoffPrerequisites,
  evaluateHandoffEligibility,
  evaluateHandoffIdempotency,
  evaluateIncompleteForwardPreflight,
  formatETag,
  GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE,
  HANDOFF_ACKNOWLEDGEMENT_V1,
  identityHandoffFingerprintHasher,
  isRecipientHandoffCapabilityActionable,
  isUnassignedCreateTaskPath,
  mapMatchedCapabilityAccessDenial,
  mapUnmatchedCapabilityAccessDenial,
  ownerActor,
  parseHandoffAcknowledgement,
  planDeliveryAccepted,
  planExplicitReforward,
  planFailedAttemptRetry,
  planNewHandoffAttempt,
  planReassignment,
  rejectClientDeliveryPathOverride,
  revokeCapability,
  selectHandoffDeliveryPath,
  type GmailConnectionFacts,
  type HandoffAttempt,
  type Recipient,
  type Task,
  type TaskCapability,
} from '../src/index.js';

const now = '2026-07-18T12:00:00.000Z';
const orgId = asOrganizationId('org_1');
const owner = ownerActor(asOwnerId('owner_1'), orgId);

const gmailConnected: GmailConnectionFacts = {
  connected: true,
  canRead: true,
  canSend: true,
  requiresSendReconsent: false,
};

function unassignedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: asTaskId('task_1'),
    organizationId: orgId,
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Do the thing' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function gmailOriginTask(overrides: Partial<Task> = {}): Task {
  return unassignedTask({
    sourceReference: {
      id: 'src_1',
      sourceType: 'gmail',
      dedupeKey: 'gmail:msg_1',
      externalIds: [{ provider: 'gmail', idType: 'message_id', id: 'msg_1' }],
      capturedAt: now,
    },
    ...overrides,
  });
}

function activeRecipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: asRecipientId('rcp_1'),
    displayName: 'Alex Recipient',
    email: 'alex@example.com',
    active: true,
    ...overrides,
  };
}

function baseAttempt(overrides: Partial<HandoffAttempt> = {}): HandoffAttempt {
  return {
    id: 'att_1',
    taskId: asTaskId('task_1'),
    organizationId: orgId,
    recipientId: asRecipientId('rcp_1'),
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    deliveryPath: 'assignment_email',
    status: 'pending',
    idempotencyKey: 'key_1',
    requestFingerprint: 'fp_1',
    capabilityId: asCapabilityId('cap_1'),
    assignmentId: asAssignmentId('asg_1'),
    providerMessageId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseCapability(overrides: Partial<TaskCapability> = {}): TaskCapability {
  return {
    id: asCapabilityId('cap_1'),
    taskId: asTaskId('task_1'),
    assignmentId: asAssignmentId('asg_1'),
    recipientId: asRecipientId('rcp_1'),
    intendedRecipientEmail: 'alex@example.com',
    scope: ['view_assigned_task', 'complete_task'],
    status: 'active',
    issuedAt: now,
    expiresAt: '2026-07-25T12:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function eligibilityBase(
  overrides: Partial<Parameters<typeof evaluateHandoffEligibility>[0]> = {},
) {
  return evaluateHandoffEligibility({
    actor: owner,
    task: unassignedTask(),
    ownerOrganizationId: orgId,
    recipient: activeRecipient(),
    recipientOrganizationId: orgId,
    recipientId: asRecipientId('rcp_1'),
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    ifMatch: formatETag('task', 'task_1', 1),
    gmailConnection: gmailConnected,
    ...overrides,
  });
}

describe('A7.2 handoff delivery path', () => {
  it('1. eligible Gmail-origin Task selects gmail_forward', () => {
    expect(selectHandoffDeliveryPath(gmailOriginTask().sourceReference)).toBe('gmail_forward');
    const result = eligibilityBase({ task: gmailOriginTask() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deliveryPath).toBe('gmail_forward');
    }
  });

  it('2. eligible non-Gmail Task selects assignment_email', () => {
    expect(selectHandoffDeliveryPath(unassignedTask().sourceReference)).toBe('assignment_email');
    const result = eligibilityBase();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deliveryPath).toBe('assignment_email');
    }
  });

  it('3. client cannot override delivery path', () => {
    const rejected = rejectClientDeliveryPathOverride('assignment_email');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure.code).toBe('VALIDATION_ERROR');
    }
    const result = eligibilityBase({ clientDeliveryPath: 'gmail_forward' });
    expect(result.ok).toBe(false);
  });
});

describe('A7.2 handoff eligibility', () => {
  it('4. assigned Task rejected', () => {
    const result = eligibilityBase({
      task: unassignedTask({
        assignment: {
          id: asAssignmentId('asg_1'),
          recipientId: asRecipientId('rcp_1'),
          intendedRecipientEmail: 'alex@example.com',
          assignedAt: now,
          assignedByOwnerId: asOwnerId('owner_1'),
          allowedCapabilityActions: [],
          deliveryStatus: 'sent',
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('DOMAIN_CONFLICT');
    }
  });

  it('5. inactive Recipient rejected', () => {
    const result = eligibilityBase({
      recipient: activeRecipient({ active: false }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('RECIPIENT_INACTIVE');
    }
  });

  it('6. cross-organization Recipient rejected', () => {
    const result = eligibilityBase({
      recipientOrganizationId: asOrganizationId('org_other'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('NOT_FOUND');
    }
  });

  it('7. Owner/self-only Task rejected', () => {
    const result = eligibilityBase({ ownerSelfWorkOnly: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('HANDOFF_NOT_ELIGIBLE');
    }
  });

  it('8. unsupported acknowledgement rejected', () => {
    expect(parseHandoffAcknowledgement('handoff_confirmed_v0').ok).toBe(false);
    expect(parseHandoffAcknowledgement(undefined).ok).toBe(false);
    expect(parseHandoffAcknowledgement({}).ok).toBe(false);
    const result = eligibilityBase({ acknowledgement: 'not_a_version' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('A7.2 Gmail prerequisites and incomplete forward', () => {
  it('9. missing Gmail connection rejected', () => {
    const result = eligibilityBase({
      gmailConnection: {
        connected: false,
        canRead: false,
        canSend: false,
        requiresSendReconsent: false,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_NOT_CONNECTED');
    }
  });

  it('10. readonly Gmail connection produces send re-consent outcome', () => {
    const result = evaluateGmailHandoffPrerequisites({
      deliveryPath: 'assignment_email',
      connection: {
        connected: true,
        canRead: true,
        canSend: false,
        requiresSendReconsent: true,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_SEND_SCOPE_REQUIRED');
    }
  });

  it('11. missing Gmail source blocks Gmail forward', () => {
    const result = evaluateGmailHandoffPrerequisites({
      deliveryPath: 'gmail_forward',
      connection: gmailConnected,
      sourceReference: {
        id: 'src_1',
        sourceType: 'gmail',
        dedupeKey: 'gmail:missing',
        capturedAt: now,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('GMAIL_SOURCE_UNAVAILABLE');
    }
  });

  it('12. incomplete attachment preflight prohibits send', () => {
    const result = evaluateIncompleteForwardPreflight('gmail_forward', {
      originalMessageAvailable: true,
      allRequiredAttachmentsAvailable: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('HANDOFF_INCOMPLETE_FORWARD_PROHIBITED');
    }
    const noFallback = assertNoDeliveryPathFallbackOnForwardFailure(
      'gmail_forward',
      'assignment_email',
    );
    expect(noFallback.ok).toBe(false);
  });
});

describe('A7.2 idempotency', () => {
  const fingerprint = computeHandoffRequestFingerprint(
    {
      organizationId: orgId,
      taskId: asTaskId('task_1'),
      recipientId: asRecipientId('rcp_1'),
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    },
    identityHandoffFingerprintHasher,
  );

  it('13. new idempotency key creates new-attempt decision', () => {
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_new',
      requestFingerprint: fingerprint,
      existingAttempt: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('new_request');
      expect(result.value.mode).toBe('new_attempt');
    }
  });

  it('14. same key and same fingerprint replays pending', () => {
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_1',
      requestFingerprint: fingerprint,
      existingAttempt: baseAttempt({
        idempotencyKey: 'key_1',
        requestFingerprint: fingerprint,
        status: 'pending',
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('replay_in_progress');
      expect(result.value.mode).toBe('replay_pending');
    }
  });

  it('15. same key and same fingerprint retries failed', () => {
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_1',
      requestFingerprint: fingerprint,
      existingAttempt: baseAttempt({
        idempotencyKey: 'key_1',
        requestFingerprint: fingerprint,
        status: 'failed',
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('retry_failed');
      expect(result.value.mode).toBe('retry_failed');
    }
  });

  it('16. same key and same fingerprint replays sent success', () => {
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_1',
      requestFingerprint: fingerprint,
      existingAttempt: baseAttempt({
        idempotencyKey: 'key_1',
        requestFingerprint: fingerprint,
        status: 'sent',
        providerMessageId: 'gmail_msg_9',
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('replay_success');
      expect(result.value.mode).toBe('replay_sent');
    }
  });

  it('17. same key with different Recipient conflicts', () => {
    const otherFp = computeHandoffRequestFingerprint(
      {
        organizationId: orgId,
        taskId: asTaskId('task_1'),
        recipientId: asRecipientId('rcp_2'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      },
      identityHandoffFingerprintHasher,
    );
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_1',
      requestFingerprint: otherFp,
      existingAttempt: baseAttempt({
        idempotencyKey: 'key_1',
        requestFingerprint: fingerprint,
        status: 'sent',
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    }
  });

  it('18. same key with different acknowledgement conflicts', () => {
    const otherFp = fingerprint.replace(HANDOFF_ACKNOWLEDGEMENT_V1, 'handoff_confirmed_v0');
    const result = evaluateHandoffIdempotency({
      idempotencyKey: 'key_1',
      requestFingerprint: otherFp,
      existingAttempt: baseAttempt({
        idempotencyKey: 'key_1',
        requestFingerprint: fingerprint,
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    }
  });
});

describe('A7.2 retry / re-forward / reassignment / capability', () => {
  it('19. failed retry reuses capability', () => {
    const plan = planFailedAttemptRetry({
      now,
      attempt: baseAttempt({ status: 'failed', capabilityId: asCapabilityId('cap_1') }),
      organizationId: orgId,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.mode).toBe('retry_failed');
      expect(plan.value.effects.some((e) => e.type === 'reuse_capability')).toBe(true);
      expect(plan.value.effects.some((e) => e.type === 'issue_capability')).toBe(false);
    }
  });

  it('20. explicit re-forward creates new attempt and capability', () => {
    const prior = baseCapability();
    const plan = planExplicitReforward({
      now,
      priorAttempt: baseAttempt({ status: 'sent', providerMessageId: 'msg_old' }),
      priorCapability: prior,
      newAttempt: {
        now,
        attemptId: 'att_2',
        assignmentId: asAssignmentId('asg_2'),
        capabilityId: asCapabilityId('cap_2'),
        task: gmailOriginTask(),
        recipient: activeRecipient(),
        ownerId: asOwnerId('owner_1'),
        organizationId: orgId,
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'gmail_forward',
        idempotencyKey: 'key_reforward',
        requestFingerprint: 'fp_reforward',
        capabilityExpiresAt: '2026-07-25T12:00:00.000Z',
      },
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.mode).toBe('explicit_reforward');
      expect(plan.value.effects.some((e) => e.type === 'supersede_capability')).toBe(true);
      expect(plan.value.effects.some((e) => e.type === 'create_attempt')).toBe(true);
      expect(plan.value.effects.some((e) => e.type === 'issue_capability')).toBe(true);
      const supersede = plan.value.effects.find((e) => e.type === 'supersede_capability');
      if (supersede && supersede.type === 'supersede_capability') {
        expect(supersede.capability.revocationReason).toBe('superseded');
      }
    }
  });

  it('21. reassignment supersedes prior capability', () => {
    const plan = planReassignment({
      now,
      priorCapability: baseCapability(),
      newAttempt: {
        now,
        attemptId: 'att_3',
        assignmentId: asAssignmentId('asg_3'),
        capabilityId: asCapabilityId('cap_3'),
        task: unassignedTask({
          assignment: {
            id: asAssignmentId('asg_1'),
            recipientId: asRecipientId('rcp_1'),
            intendedRecipientEmail: 'alex@example.com',
            assignedAt: now,
            assignedByOwnerId: asOwnerId('owner_1'),
            allowedCapabilityActions: [],
            deliveryStatus: 'sent',
            activeCapabilityId: 'cap_1',
            capabilityStatus: 'active',
          },
        }),
        recipient: activeRecipient({
          id: asRecipientId('rcp_2'),
          email: 'blake@example.com',
          displayName: 'Blake',
        }),
        ownerId: asOwnerId('owner_1'),
        organizationId: orgId,
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
        deliveryPath: 'assignment_email',
        idempotencyKey: 'key_reassign',
        requestFingerprint: 'fp_reassign',
        capabilityExpiresAt: '2026-07-25T12:00:00.000Z',
      },
    });
    expect(plan.mode).toBe('reassignment');
    const supersede = plan.effects.find((e) => e.type === 'supersede_capability');
    expect(supersede).toBeDefined();
    if (supersede && supersede.type === 'supersede_capability') {
      expect(supersede.capability.revocationReason).toBe('superseded');
    }
  });

  it('22. superseded capability maps to CAPABILITY_NO_LONGER_ACTIVE', () => {
    const result = mapMatchedCapabilityAccessDenial({
      status: 'revoked',
      revocationReason: 'superseded',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('CAPABILITY_NO_LONGER_ACTIVE');
      expect(result.failure.message).toBe('This link is no longer active.');
      expect(JSON.stringify(result.failure)).not.toContain('superseded');
    }
  });

  it('23. matched manual revocation maps to generic UNAUTHORIZED', () => {
    const manual = revokeCapability(baseCapability(), now, 'manual');
    expect(manual.revocationReason).toBe('manual');
    const result = mapMatchedCapabilityAccessDenial({
      status: manual.status,
      revocationReason: manual.revocationReason,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('UNAUTHORIZED');
      expect(result.failure.code).not.toBe('CAPABILITY_NO_LONGER_ACTIVE');
      expect(result.failure.code).not.toBe('FORBIDDEN');
      expect(result.failure.message).toBe(GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE);
      expect(JSON.stringify(result.failure)).not.toMatch(/manual|revocationReason/i);
    }
  });

  it('23b. matched assignment_ended maps to generic UNAUTHORIZED', () => {
    const result = mapMatchedCapabilityAccessDenial({
      status: 'revoked',
      revocationReason: 'assignment_ended',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('UNAUTHORIZED');
      expect(result.failure.message).toBe(GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE);
      expect(JSON.stringify(result.failure)).not.toContain('assignment_ended');
    }
  });

  it('23c. matched expired maps to generic UNAUTHORIZED', () => {
    const result = mapMatchedCapabilityAccessDenial({
      status: 'expired',
      revocationReason: 'expired',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('UNAUTHORIZED');
      expect(result.failure.message).toBe(GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE);
      expect(JSON.stringify(result.failure)).not.toContain('expired');
    }
  });

  it('23d. unknown/unmatched capability maps to generic UNAUTHORIZED', () => {
    const unmatched = mapUnmatchedCapabilityAccessDenial();
    const manual = mapMatchedCapabilityAccessDenial({
      status: 'revoked',
      revocationReason: 'manual',
    });
    expect(unmatched.ok).toBe(false);
    expect(manual.ok).toBe(false);
    if (!unmatched.ok && !manual.ok) {
      expect(unmatched.failure.code).toBe('UNAUTHORIZED');
      expect(unmatched.failure.message).toBe(GENERIC_CAPABILITY_UNAUTHORIZED_MESSAGE);
      // Indistinguishable public envelope from non-superseded matched denial.
      expect(unmatched.failure.code).toBe(manual.failure.code);
      expect(unmatched.failure.message).toBe(manual.failure.message);
    }
  });

  it('24. pending/failed capability cannot become actionable', () => {
    const capability = baseCapability();
    expect(
      isRecipientHandoffCapabilityActionable({
        capability,
        deliveryStatus: 'pending',
        now,
      }),
    ).toBe(false);
    expect(
      isRecipientHandoffCapabilityActionable({
        capability,
        deliveryStatus: 'failed',
        now,
      }),
    ).toBe(false);
  });

  it('25. send acceptance transitions to sent and activates Assignment/capability', () => {
    const plan = planDeliveryAccepted({
      now,
      attempt: baseAttempt({ status: 'pending' }),
      assignmentId: asAssignmentId('asg_1'),
      capabilityId: asCapabilityId('cap_1'),
      providerMessageId: 'gmail_accepted_1',
      organizationId: orgId,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.effects.some((e) => e.type === 'mark_attempt_sent')).toBe(true);
      expect(plan.value.effects.some((e) => e.type === 'activate_assignment')).toBe(true);
      expect(plan.value.effects.some((e) => e.type === 'activate_capability')).toBe(true);
      expect(
        isRecipientHandoffCapabilityActionable({
          capability: baseCapability(),
          deliveryStatus: 'sent',
          now,
        }),
      ).toBe(true);
    }
  });

  it('26. provider acceptance does not imply Recipient read/open', () => {
    const plan = planDeliveryAccepted({
      now,
      attempt: baseAttempt({ status: 'pending' }),
      assignmentId: asAssignmentId('asg_1'),
      capabilityId: asCapabilityId('cap_1'),
      providerMessageId: 'gmail_accepted_1',
      organizationId: orgId,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.impliesRecipientRead).toBe(false);
    }
  });
});

describe('A7.2 create-with-recipient and audit privacy', () => {
  it('27. create-with-recipient policy is rejected for the future A7 path', () => {
    expect(isUnassignedCreateTaskPath(undefined)).toBe(true);
    const rejected = assertCreateTaskRejectsRecipientId('rcp_1');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.failure.code).toBe('RECIPIENT_HANDOFF_NOT_AVAILABLE');
    }
  });

  it('28. no raw secrets or message contents appear in domain outputs/audit intents', () => {
    const plan = planNewHandoffAttempt({
      now,
      attemptId: 'att_1',
      assignmentId: asAssignmentId('asg_1'),
      capabilityId: asCapabilityId('cap_1'),
      task: unassignedTask(),
      recipient: activeRecipient(),
      ownerId: asOwnerId('owner_1'),
      organizationId: orgId,
      acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      deliveryPath: 'assignment_email',
      idempotencyKey: 'key_1',
      requestFingerprint: 'fp_1',
      capabilityExpiresAt: '2026-07-25T12:00:00.000Z',
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/mime|oauth|attachmentBytes|messageBody|Bearer /i);
    for (const intent of plan.auditIntents) {
      expect(() => assertHandoffAuditIntentIsPrivacySafe(intent)).not.toThrow();
      expect(intent).not.toHaveProperty('token');
      expect(intent).not.toHaveProperty('secret');
    }
    const issued = plan.effects.find((e) => e.type === 'issue_capability');
    expect(issued).toBeDefined();
    if (issued && issued.type === 'issue_capability') {
      expect(issued).not.toHaveProperty('rawToken');
      expect(issued.actionable).toBe(false);
    }
  });
});

describe('A7.2 fingerprint excludes concurrency token', () => {
  it('If-Match / Task version are not part of the fingerprint', () => {
    const a = computeHandoffRequestFingerprint(
      {
        organizationId: orgId,
        taskId: asTaskId('task_1'),
        recipientId: asRecipientId('rcp_1'),
        acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
      },
      identityHandoffFingerprintHasher,
    );
    expect(a).not.toContain('version');
    expect(a).not.toContain('If-Match');
    expect(a).toContain('organizationId=');
    expect(a).toContain('taskId=');
    expect(a).toContain('recipientId=');
    expect(a).toContain('acknowledgement=');
  });
});
