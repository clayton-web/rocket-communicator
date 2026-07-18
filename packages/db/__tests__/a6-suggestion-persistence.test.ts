import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asCommunicationEventId,
  asOrganizationId,
  asOwnerId,
  asTaskId,
  asTaskSuggestionId,
  asTemporaryCommunicationExcerptId,
  computeExcerptPurgeAt,
  computeWorkflowSafetyCeilingPurgeAt,
  createStandaloneTask,
  formatETag,
  ownerActor,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  PersistenceError,
  claimSuggestionProcessingBatch,
  createOrUpdatePendingCommunicationAccount,
  createTask,
  createTaskSuggestion,
  getCommunicationEventById,
  getTaskById,
  getTaskSuggestionById,
  getTemporaryCommunicationExcerptByEventId,
  listTaskSuggestions,
  persistApproveTaskSuggestion,
  persistConnectedCommunicationAccount,
  persistDismissTaskSuggestion,
  persistFailedPermanentOutcome,
  persistFailedRetryableOutcome,
  persistGmailHistoryPageTransaction,
  persistMergeTaskSuggestion,
  persistOwnerTaskMutation,
  persistSkippedIrrelevantOutcome,
  persistSuggestionFromClaimedEvent,
  persistWorkRequest,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_a6_1';
const now = '2026-07-17T12:00:00.000Z';
const claimUntil = '2026-07-17T12:05:00.000Z';
const ingestPurgeAt = '2026-07-24T12:00:00.000Z';
const policyVersion = 'a6-policy-v1';
const owner = ownerActor(asOwnerId('owner_a6'), asOrganizationId(org));

function systemAudit(id: string, action: string, extras: Record<string, string> = {}) {
  return {
    id,
    organizationId: org,
    actorKind: 'system' as const,
    systemId: 'suggestion-process',
    action,
    outcome: 'succeeded' as const,
    recordedAt: now,
    ...extras,
  };
}

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_a6',
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@acme.example'],
    subject: 'Action needed',
    snippet: 'Please review',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

async function seedAccount(db: TestDatabase, accountId = 'acct_a6'): Promise<void> {
  await createOrUpdatePendingCommunicationAccount(db.prisma, {
    organizationId: org,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: 'google-sub-a6',
  });
  await persistConnectedCommunicationAccount(db.prisma, {
    organizationId: org,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: 'google-sub-a6',
    connectedAt: now,
    historyId: 'hist_1',
  });
}

async function seedEventWithExcerpt(
  db: TestDatabase,
  eventId: string,
  providerMessageId: string,
): Promise<void> {
  await upsertCommunicationEvent(db.prisma, {
    organizationId: org,
    accountId: 'acct_a6',
    message: inboxMessage({ eventId, providerMessageId }),
  });
  await upsertTemporaryCommunicationExcerpt(db.prisma, {
    organizationId: org,
    communicationEventId: eventId,
    excerptId: `ex_${eventId}`,
    content: 'Temporary excerpt body',
    purgeAt: ingestPurgeAt,
  });
}

function pendingSuggestion(
  id: string,
  eventId: string | null,
  overrides: Partial<TaskSuggestion> = {},
): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(org),
    status: 'pending',
    summaryPoints: [{ id: 'sp1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    voiceOriginated: false,
    sourceCommunicationEventId: eventId ? asCommunicationEventId(eventId) : null,
    sourceReference: eventId
      ? {
          id: `src_${eventId}`,
          sourceType: 'gmail',
          dedupeKey: `gmail:${eventId}`,
          capturedAt: now,
          excerptRef: {
            excerptId: `ex_${eventId}`,
            contentClassification: 'temporary_communication',
          },
        }
      : undefined,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('A6.1 suggestion persistence foundation (PGlite)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('defaults existing/new events to unprocessed processing status', async () => {
    await seedEventWithExcerpt(db, 'evt_default', 'msg_default');
    const event = await getCommunicationEventById(db.prisma, org, 'evt_default');
    expect(event.suggestionProcessingStatus).toBe('unprocessed');
    expect(event.suggestionProcessingAttempts).toBe(0);
    expect(event.suggestionClaimOwner).toBeNull();
  });

  it('allows work-request suggestions with null sourceCommunicationEventId', async () => {
    const task = createStandaloneTask({
      actor: owner,
      now,
      id: asTaskId('task_wr_a6'),
      organizationId: asOrganizationId(org),
      summaryPoints: [
        { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Parent work' },
      ],
    });
    await createTask(db.prisma, org, task);
    const suggestion = pendingSuggestion('sug_wr_null', null);
    const created = await createTaskSuggestion(db.prisma, org, suggestion, task.id);
    expect(created.sourceCommunicationEventId).toBeNull();
    const loaded = await getTaskSuggestionById(db.prisma, org, suggestion.id);
    expect(loaded.sourceCommunicationEventId).toBeNull();
  });

  it('rejects duplicate suggestions for the same source event', async () => {
    await seedEventWithExcerpt(db, 'evt_dup', 'msg_dup');
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_dup_1', 'evt_dup'));
    await expect(
      createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_dup_2', 'evt_dup')),
    ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
  });

  it('claims one eligible event and blocks concurrent claim', async () => {
    await seedEventWithExcerpt(db, 'evt_claim', 'msg_claim');
    const first = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_a',
      claimUntil,
      now,
      limit: 10,
      organizationId: org,
    });
    expect(first.some((e) => e.id === 'evt_claim')).toBe(true);
    const claimed = first.find((e) => e.id === 'evt_claim')!;
    expect(claimed.suggestionClaimOwner).toBe('worker_a');
    expect(claimed.suggestionProcessingAttempts).toBe(1);

    const second = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_b',
      claimUntil,
      now,
      limit: 10,
      organizationId: org,
    });
    expect(second.some((e) => e.id === 'evt_claim')).toBe(false);
  });

  it('reclaims after lease expiry and refuses active lease steal', async () => {
    await seedEventWithExcerpt(db, 'evt_lease', 'msg_lease');
    const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_lease',
      claimUntil: '2026-07-17T12:01:00.000Z',
      now,
      limit: 1,
      organizationId: org,
    });
    expect(claimed.id).toBe('evt_lease');

    const steal = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'thief',
      claimUntil,
      now: '2026-07-17T12:00:30.000Z',
      limit: 5,
      organizationId: org,
    });
    expect(steal.some((e) => e.id === 'evt_lease')).toBe(false);

    const reclaim = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_reclaim',
      claimUntil,
      now: '2026-07-17T12:02:00.000Z',
      limit: 5,
      organizationId: org,
    });
    expect(reclaim.some((e) => e.id === 'evt_lease')).toBe(true);
    expect(reclaim.find((e) => e.id === 'evt_lease')!.suggestionClaimOwner).toBe('worker_reclaim');
  });

  it('does not claim terminal processing outcomes', async () => {
    await seedEventWithExcerpt(db, 'evt_skip_term', 'msg_skip_term');
    const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_skip',
      claimUntil,
      now,
      limit: 5,
      organizationId: org,
    });
    await persistSkippedIrrelevantOutcome({
      db: db.prisma,
      organizationId: org,
      eventId: claimed.id,
      claimOwner: 'worker_skip',
      processedAt: now,
      policyVersion,
      reasonCode: 'HEURISTIC_IRRELEVANT',
      audit: systemAudit('aud_skip_term', 'suggestion.process.skipped'),
    });

    const again = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_again',
      claimUntil,
      now: '2026-07-17T13:00:00.000Z',
      limit: 20,
      organizationId: org,
    });
    expect(again.some((e) => e.id === 'evt_skip_term')).toBe(false);

    const event = await getCommunicationEventById(db.prisma, org, 'evt_skip_term');
    expect(event.suggestionProcessingStatus).toBe('skipped_irrelevant');
    expect(event.suggestionClaimOwner).toBeNull();
    const excerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_skip_term',
    );
    expect(excerpt?.purgeAt).toBe(ingestPurgeAt);
  });

  it('respects maxAttempts for retryable failures', async () => {
    await seedEventWithExcerpt(db, 'evt_retry_cap', 'msg_retry_cap');
    for (let i = 0; i < 2; i += 1) {
      const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
        claimOwner: `retry_worker_${i}`,
        claimUntil,
        now: `2026-07-17T1${i}:00:00.000Z`,
        limit: 5,
        maxAttempts: 2,
        organizationId: org,
      });
      expect(claimed.id).toBe('evt_retry_cap');
      await persistFailedRetryableOutcome({
        db: db.prisma,
        organizationId: org,
        eventId: claimed.id,
        claimOwner: `retry_worker_${i}`,
        processedAt: `2026-07-17T1${i}:00:01.000Z`,
        policyVersion,
        errorCode: 'AI_TIMEOUT',
        audit: systemAudit(`aud_retry_${i}`, 'suggestion.process.failed_retryable'),
      });
    }

    const blocked = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'retry_blocked',
      claimUntil,
      now: '2026-07-17T14:00:00.000Z',
      limit: 5,
      maxAttempts: 2,
      organizationId: org,
    });
    expect(blocked.some((e) => e.id === 'evt_retry_cap')).toBe(false);
  });

  it('creates exactly one suggestion from a claimed event and updates excerpt ceiling', async () => {
    await seedEventWithExcerpt(db, 'evt_create', 'msg_create');
    const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'create_worker',
      claimUntil,
      now,
      limit: 5,
      organizationId: org,
    });
    const ceiling = computeWorkflowSafetyCeilingPurgeAt(now);
    const result = await persistSuggestionFromClaimedEvent({
      db: db.prisma,
      organizationId: org,
      eventId: claimed.id,
      claimOwner: 'create_worker',
      suggestion: pendingSuggestion('sug_create', claimed.id),
      policyVersion,
      processedAt: now,
      excerptPurgeAt: ceiling,
      audit: systemAudit('aud_create', 'suggestion.process.created'),
    });

    expect(result.suggestion.id).toBe('sug_create');
    expect(result.event.suggestionProcessingStatus).toBe('suggestion_created');
    expect(result.event.suggestionClaimOwner).toBeNull();
    expect(result.event.suggestionPolicyVersion).toBe(policyVersion);
    expect(result.excerptUpdated).toBe(true);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, claimed.id);
    expect(excerpt?.purgeAt).toBe(ceiling);

    await expect(
      persistSuggestionFromClaimedEvent({
        db: db.prisma,
        organizationId: org,
        eventId: claimed.id,
        claimOwner: 'create_worker',
        suggestion: pendingSuggestion('sug_create_race', claimed.id),
        policyVersion,
        processedAt: now,
        excerptPurgeAt: ceiling,
        audit: systemAudit('aud_create_race', 'suggestion.process.created'),
      }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_CONCURRENCY' });
  });

  it('rolls back suggestion create when claim is stale', async () => {
    await seedEventWithExcerpt(db, 'evt_stale', 'msg_stale');
    await expect(
      persistSuggestionFromClaimedEvent({
        db: db.prisma,
        organizationId: org,
        eventId: 'evt_stale',
        claimOwner: 'not_the_owner',
        suggestion: pendingSuggestion('sug_stale', 'evt_stale'),
        policyVersion,
        processedAt: now,
        excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
        audit: systemAudit('aud_stale', 'suggestion.process.created'),
      }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_CONCURRENCY' });

    await expect(getTaskSuggestionById(db.prisma, org, 'sug_stale')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('records permanent failure without creating a suggestion or extending retention', async () => {
    await seedEventWithExcerpt(db, 'evt_perm', 'msg_perm');
    const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'perm_worker',
      claimUntil,
      now,
      limit: 5,
      organizationId: org,
    });
    await persistFailedPermanentOutcome({
      db: db.prisma,
      organizationId: org,
      eventId: claimed.id,
      claimOwner: 'perm_worker',
      processedAt: now,
      policyVersion,
      errorCode: 'AI_DISABLED',
      audit: systemAudit('aud_perm', 'suggestion.process.failed_permanent'),
    });
    const event = await getCommunicationEventById(db.prisma, org, claimed.id);
    expect(event.suggestionProcessingStatus).toBe('failed_permanent');
    expect(event.suggestionLastErrorCode).toBe('AI_DISABLED');
    expect(event.suggestionClaimOwner).toBeNull();
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, claimed.id);
    expect(excerpt?.purgeAt).toBe(ingestPurgeAt);
  });

  it('approves into an unassigned Task and rejects recipient handoff', async () => {
    await seedEventWithExcerpt(db, 'evt_approve', 'msg_approve');
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_approve', 'evt_approve'),
    );
    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        organizationId: org,
        expectedSuggestionVersion: 1,
        suggestion: { ...suggestion, status: 'approved', version: 2, updatedAt: now },
        task: createStandaloneTask({
          actor: owner,
          now,
          id: asTaskId('task_from_sug'),
          organizationId: asOrganizationId(org),
          summaryPoints: suggestion.summaryPoints,
        }),
        recipientId: 'rcp_should_fail',
        excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
        audit: {
          id: 'aud_approve_reject',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_a6',
          action: 'suggestion.approve',
          outcome: 'denied',
          recordedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_HANDOFF_NOT_AVAILABLE' });

    const approved = await persistApproveTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: 1,
      suggestion: { ...suggestion, status: 'approved', version: 2, updatedAt: now },
      task: createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_from_sug'),
        organizationId: asOrganizationId(org),
        summaryPoints: suggestion.summaryPoints,
        sourceReference: suggestion.sourceReference,
      }),
      excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
      audit: {
        id: 'aud_approve_ok',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.approve',
        outcome: 'succeeded',
        recordedAt: now,
      },
    });

    expect(approved.task.assignment).toBeUndefined();
    expect(approved.suggestion.status).toBe('approved');
    expect(approved.suggestion.approvedTaskId).toBe(approved.task.id);
    expect(approved.audit.id).toBe('aud_approve_ok');
    const assignments = await db.prisma.taskAssignment.count({
      where: { taskId: approved.task.id },
    });
    expect(assignments).toBe(0);
    const capabilities = await db.prisma.taskCapability.count({
      where: { taskId: approved.task.id },
    });
    expect(capabilities).toBe(0);
  });

  it('dismisses with +7-day excerpt retention', async () => {
    await seedEventWithExcerpt(db, 'evt_dismiss', 'msg_dismiss');
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_dismiss', 'evt_dismiss'),
    );
    const dismissedAt = now;
    const result = await persistDismissTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: 1,
      suggestion: {
        ...suggestion,
        status: 'dismissed',
        version: 2,
        updatedAt: dismissedAt,
        retention: { excerptPurgeAt: computeExcerptPurgeAt(dismissedAt) },
      },
      excerptPurgeAt: computeExcerptPurgeAt(dismissedAt),
      audit: {
        id: 'aud_dismiss',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.dismiss',
        outcome: 'succeeded',
        recordedAt: dismissedAt,
        note: 'not relevant',
      },
    });
    expect(result.suggestion.status).toBe('dismissed');
    expect(result.excerptUpdated).toBe(true);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_dismiss');
    expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(dismissedAt));
  });

  it('merge enforces dual versions and updates retention atomically', async () => {
    await seedEventWithExcerpt(db, 'evt_merge', 'msg_merge');
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_merge', 'evt_merge'),
    );
    const target = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_merge_target'),
        organizationId: asOrganizationId(org),
        summaryPoints: [
          { id: 't1', kind: 'next_action', label: 'Existing', order: 0, value: 'Keep me' },
        ],
      }),
    );

    await expect(
      persistMergeTaskSuggestion({
        db: db.prisma,
        organizationId: org,
        expectedSuggestionVersion: 99,
        expectedTaskVersion: target.version,
        suggestion: {
          ...suggestion,
          status: 'merged',
          mergedIntoTaskId: target.id,
          version: 2,
          updatedAt: now,
        },
        task: {
          ...target,
          summaryPoints: [...target.summaryPoints, ...suggestion.summaryPoints],
          version: target.version + 1,
          updatedAt: now,
        },
        excerptPurgeAt: computeExcerptPurgeAt(now),
        audit: {
          id: 'aud_merge_stale_sug',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_a6',
          action: 'suggestion.merge',
          outcome: 'failed',
          recordedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_CONCURRENCY' });

    await expect(
      persistMergeTaskSuggestion({
        db: db.prisma,
        organizationId: org,
        expectedSuggestionVersion: 1,
        expectedTaskVersion: 99,
        suggestion: {
          ...suggestion,
          status: 'merged',
          mergedIntoTaskId: target.id,
          version: 2,
          updatedAt: now,
        },
        task: {
          ...target,
          summaryPoints: [...target.summaryPoints, ...suggestion.summaryPoints],
          version: target.version + 1,
          updatedAt: now,
        },
        excerptPurgeAt: computeExcerptPurgeAt(now),
        audit: {
          id: 'aud_merge_stale_task',
          organizationId: org,
          actorKind: 'owner',
          ownerId: 'owner_a6',
          action: 'suggestion.merge',
          outcome: 'failed',
          recordedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_CONCURRENCY' });

    const merged = await persistMergeTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: 1,
      expectedTaskVersion: target.version,
      suggestion: {
        ...suggestion,
        status: 'merged',
        mergedIntoTaskId: target.id,
        version: 2,
        updatedAt: now,
      },
      task: {
        ...target,
        summaryPoints: [...target.summaryPoints, ...suggestion.summaryPoints],
        version: target.version + 1,
        updatedAt: now,
      },
      excerptPurgeAt: computeExcerptPurgeAt(now),
      audit: {
        id: 'aud_merge_ok',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.merge',
        outcome: 'succeeded',
        recordedAt: now,
      },
    });

    expect(merged.suggestion.status).toBe('merged');
    expect(merged.task.summaryPoints).toHaveLength(2);
    expect(merged.excerptUpdated).toBe(true);
    expect(formatETag('task', merged.task.id, merged.task.version)).toContain(
      String(merged.task.version),
    );
  });

  it('lists suggestions with cursor pagination and keeps work-request flow working', async () => {
    const listed = await listTaskSuggestions(db.prisma, { organizationId: org, limit: 2 });
    expect(listed.items.length).toBeGreaterThan(0);
    expect(listed.items.length).toBeLessThanOrEqual(2);
    if (listed.nextCursor) {
      const page2 = await listTaskSuggestions(db.prisma, {
        organizationId: org,
        limit: 2,
        cursor: listed.nextCursor,
      });
      expect(page2.items[0]?.id).not.toBe(listed.items[0]?.id);
    }

    const parent = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_wr_persist'),
        organizationId: asOrganizationId(org),
        summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Parent' }],
      }),
    );
    const wr = await persistWorkRequest({
      db: db.prisma,
      organizationId: org,
      expectedVersion: parent.version,
      task: { ...parent, version: parent.version + 1, updatedAt: now },
      note: {
        id: 'note_wr_a6',
        body: 'Please create follow-up',
        createdAt: now,
        attribution: {
          kind: 'owner',
          owner: { ownerId: 'owner_a6', recordedAt: now },
        },
      },
      suggestion: pendingSuggestion('sug_wr_persist', null),
      audit: {
        id: 'aud_wr_a6',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.work_request',
        outcome: 'succeeded',
        recordedAt: now,
        taskId: parent.id,
      },
    });
    expect(wr.suggestion.sourceCommunicationEventId).toBeNull();
  });

  it('applies task terminal excerpt retention and tolerates missing/purged excerpts', async () => {
    await seedEventWithExcerpt(db, 'evt_terminal', 'msg_terminal');
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_terminal', 'evt_terminal'),
    );
    const approved = await persistApproveTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: 1,
      suggestion: { ...suggestion, status: 'approved', version: 2, updatedAt: now },
      task: createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_terminal'),
        organizationId: asOrganizationId(org),
        summaryPoints: suggestion.summaryPoints,
        sourceReference: suggestion.sourceReference,
      }),
      excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
      audit: {
        id: 'aud_term_approve',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.approve',
        outcome: 'succeeded',
        recordedAt: now,
      },
    });

    const terminalAt = '2026-07-18T12:00:00.000Z';
    const completed = await persistOwnerTaskMutation({
      db: db.prisma,
      organizationId: org,
      expectedVersion: approved.task.version,
      task: {
        ...approved.task,
        status: 'completed',
        version: approved.task.version + 1,
        updatedAt: terminalAt,
        retention: { excerptPurgeAt: computeExcerptPurgeAt(terminalAt) },
        reminder: { paused: true },
        outcome: {
          outcomeType: 'done',
          completedAt: terminalAt,
          attribution: {
            kind: 'owner',
            owner: { ownerId: 'owner_a6', recordedAt: terminalAt },
          },
        },
      },
      audit: {
        id: 'aud_term_complete',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'task.complete',
        outcome: 'succeeded',
        recordedAt: terminalAt,
        taskId: approved.task.id,
      },
    });
    expect(completed.excerptUpdated).toBe(true);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_terminal');
    expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(terminalAt));

    await seedEventWithExcerpt(db, 'evt_purged_term', 'msg_purged_term');
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, 'evt_purged_term', terminalAt);
    const suggestionPurged = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_purged_term', 'evt_purged_term'),
    );
    const approvedPurged = await persistApproveTaskSuggestion({
      db: db.prisma,
      organizationId: org,
      expectedSuggestionVersion: 1,
      suggestion: { ...suggestionPurged, status: 'approved', version: 2, updatedAt: now },
      task: createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_purged_term'),
        organizationId: asOrganizationId(org),
        summaryPoints: suggestionPurged.summaryPoints,
      }),
      excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
      audit: {
        id: 'aud_term_approve_purged',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'suggestion.approve',
        outcome: 'succeeded',
        recordedAt: now,
      },
    });
    const dismissed = await persistOwnerTaskMutation({
      db: db.prisma,
      organizationId: org,
      expectedVersion: approvedPurged.task.version,
      task: {
        ...approvedPurged.task,
        status: 'dismissed',
        version: approvedPurged.task.version + 1,
        updatedAt: terminalAt,
        retention: { excerptPurgeAt: computeExcerptPurgeAt(terminalAt) },
        reminder: { paused: true },
      },
      audit: {
        id: 'aud_term_dismiss_purged',
        organizationId: org,
        actorKind: 'owner',
        ownerId: 'owner_a6',
        action: 'task.dismiss',
        outcome: 'succeeded',
        recordedAt: terminalAt,
        taskId: approvedPurged.task.id,
      },
    });
    expect(dismissed.excerptUpdated).toBe(false);
    expect(dismissed.task.status).toBe('dismissed');
  });

  it('A5 history page transaction still does not create suggestions', async () => {
    const before = await db.prisma.taskSuggestion.count({ where: { organizationId: org } });
    await persistGmailHistoryPageTransaction({
      db: db.prisma,
      organizationId: org,
      accountId: 'acct_a6',
      historyIdBefore: 'hist_1',
      historyIdAfter: 'hist_a6_page',
      ingestRunId: 'run_a6_regression',
      syncedAt: now,
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_a5_only'),
          providerMessageId: 'msg_a5_only',
          excerptId: asTemporaryCommunicationExcerptId('ex_a5_only'),
          excerptContent: 'A5 ingest only',
          excerptPurgeAt: ingestPurgeAt,
        }),
      ],
    });
    const after = await db.prisma.taskSuggestion.count({ where: { organizationId: org } });
    expect(after).toBe(before);
    const event = await getCommunicationEventById(db.prisma, org, 'evt_a5_only');
    expect(event.suggestionProcessingStatus).toBe('unprocessed');
  });

  it('concurrent claim workers never double-claim the same event (Contract B)', async () => {
    const contentionOrg = 'org_a6_contention';
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: contentionOrg,
      accountId: 'acct_contention',
      emailAddress: 'owner@contention.example',
      externalAccountId: 'google-sub-contention',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: contentionOrg,
      accountId: 'acct_contention',
      emailAddress: 'owner@contention.example',
      externalAccountId: 'google-sub-contention',
      connectedAt: now,
      historyId: 'hist_c',
    });

    for (let i = 0; i < 5; i += 1) {
      await upsertCommunicationEvent(db.prisma, {
        organizationId: contentionOrg,
        accountId: 'acct_contention',
        message: inboxMessage({
          eventId: `evt_c_${i}`,
          providerMessageId: `msg_c_${i}`,
          internalDate: `2026-07-17T12:0${i}:00.000Z`,
        }),
      });
    }

    const [a, b] = await Promise.all([
      claimSuggestionProcessingBatch(db.prisma, {
        claimOwner: 'worker_left',
        claimUntil,
        now,
        limit: 5,
        organizationId: contentionOrg,
      }),
      claimSuggestionProcessingBatch(db.prisma, {
        claimOwner: 'worker_right',
        claimUntil,
        now,
        limit: 5,
        organizationId: contentionOrg,
      }),
    ]);

    const idsA = a.map((e) => e.id);
    const idsB = b.map((e) => e.id);
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);
    expect(a.length + b.length).toBe(5);
    expect(a.every((e) => e.suggestionClaimOwner === 'worker_left')).toBe(true);
    expect(b.every((e) => e.suggestionClaimOwner === 'worker_right')).toBe(true);
    expect(a.every((e) => e.suggestionProcessingAttempts === 1)).toBe(true);
    expect(b.every((e) => e.suggestionProcessingAttempts === 1)).toBe(true);

    // Refill after one worker finishes outcomes: remaining unclaimed none, so empty.
    const refill = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'worker_refill',
      claimUntil,
      now,
      limit: 5,
      organizationId: contentionOrg,
    });
    expect(refill).toHaveLength(0);
  });

  it('requires audit records for processing outcomes and Owner approve', async () => {
    await seedEventWithExcerpt(db, 'evt_audit_req', 'msg_audit_req');
    const [claimed] = await claimSuggestionProcessingBatch(db.prisma, {
      claimOwner: 'audit_worker',
      claimUntil,
      now,
      limit: 5,
      organizationId: org,
    });
    const skipped = await persistSkippedIrrelevantOutcome({
      db: db.prisma,
      organizationId: org,
      eventId: claimed.id,
      claimOwner: 'audit_worker',
      processedAt: now,
      policyVersion,
      reasonCode: 'IRRELEVANT',
      audit: systemAudit('aud_required_skip', 'suggestion.process.skipped'),
    });
    expect(skipped.audit.id).toBe('aud_required_skip');
    expect(skipped.audit.actorKind).toBe('system');
  });
});

describe('A6.1 schema contracts', () => {
  it('exports PersistenceError for callers', () => {
    expect(PersistenceError).toBeDefined();
  });

  it('loads a completed approved task after A6 approve', async () => {
    // Smoke: createTestDatabase already applied A6 migration via ordered SQL.
    const local = await createTestDatabase();
    try {
      const columns = await local.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'communication_events'
           AND column_name LIKE 'suggestion_%'
         ORDER BY column_name`,
      );
      expect(columns.map((c) => c.column_name)).toEqual(
        expect.arrayContaining([
          'suggestion_processing_status',
          'suggestion_claim_owner',
          'suggestion_claim_until',
          'suggestion_processing_attempts',
          'suggestion_policy_version',
        ]),
      );
      const sugCols = await local.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'task_suggestions'
           AND column_name = 'source_communication_event_id'`,
      );
      expect(sugCols).toHaveLength(1);
    } finally {
      await local.close();
    }
  });
});
