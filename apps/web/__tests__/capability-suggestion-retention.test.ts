// @vitest-environment node
/**
 * A6.2 — D082 terminal excerpt retention through the real Recipient capability
 * complete HTTP route (persistCapabilityAction).
 *
 * Relationship path exercised:
 *   Task (completed via capability)
 *     → TaskSuggestion.approvedTaskId = Task.id (status approved)
 *     → TaskSuggestion.sourceCommunicationEventId
 *     → TemporaryCommunicationExcerpt.communicationEventId
 *     → purgeAt = task.updatedAt + 7 days
 *
 * Approve creates an unassigned Task (D080). The smallest A4 setup then
 * attaches TaskAssignment + capability via createActiveAssignment +
 * issueCapabilityForTask so the capability complete route can run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asCommunicationEventId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskSuggestionId,
  computeExcerptPurgeAt,
  computeWorkflowSafetyCeilingPurgeAt,
  formatETag,
  ownerActor,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  createActiveAssignment,
  createOrUpdatePendingCommunicationAccount,
  createTaskSuggestion,
  getTemporaryCommunicationExcerptByEventId,
  persistConnectedCommunicationAccount,
  purgeTemporaryCommunicationExcerpt,
  upsertCommunicationEvent,
  upsertRecipient,
  upsertTemporaryCommunicationExcerpt,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { issueCapabilityForTask } from '@/lib/capability';
import { seedAssignedTaskViaService } from './helpers/seed-assigned-task';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { POST as approveSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/approve/route';
import { POST as completeCapability } from '@/app/api/v1/capabilities/[token]/tasks/[taskId]/complete/route';

const org = 'org_cap_d082';
const now = '2026-07-17T16:00:00.000Z';
const ingestPurgeAt = '2026-07-24T16:00:00.000Z';
const pepper = 'capability-pepper-value-32chars!!';
const appUrl = 'http://localhost:3000';
const owner = ownerActor(asOwnerId('owner_cap_d082'), asOrganizationId(org));
const ORIGINAL_ENV = { ...process.env };

function authOwner() {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: owner.ownerId } as never,
    actor: owner,
    session: {
      ownerId: owner.ownerId,
      organizationId: owner.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function setCapabilityEnv() {
  process.env.CAPABILITY_TOKEN_PEPPER = pepper;
  process.env.CAPABILITY_TTL_MS = String(DEFAULT_CAPABILITY_TTL_MS);
  process.env.NEXT_PUBLIC_APP_URL = appUrl;
}

function suggestionParams(suggestionId: string) {
  return { params: Promise.resolve({ suggestionId }) };
}

function capabilityParams(token: string, taskId: string) {
  return { params: Promise.resolve({ token, taskId }) };
}

function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json', ...headers };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function pendingSuggestion(id: string, eventId: string | null): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(org),
    status: 'pending',
    summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
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
  };
}

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_cap_d082',
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

describe('A6.2 capability HTTP D082 terminal retention', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createOrUpdatePendingCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_cap_d082',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-cap-d082',
    });
    await persistConnectedCommunicationAccount(db.prisma, {
      organizationId: org,
      accountId: 'acct_cap_d082',
      emailAddress: 'owner@acme.example',
      externalAccountId: 'google-cap-d082',
      connectedAt: now,
      historyId: 'hist_1',
    });
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(() => {
    installDbTestRuntime(db.prisma);
    authOwner();
    setCapabilityEnv();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  async function seedEventWithExcerpt(eventId: string, providerMessageId: string) {
    await upsertCommunicationEvent(db.prisma, {
      organizationId: org,
      accountId: 'acct_cap_d082',
      message: inboxMessage({ eventId, providerMessageId }),
    });
    await upsertTemporaryCommunicationExcerpt(db.prisma, {
      organizationId: org,
      communicationEventId: eventId,
      excerptId: `ex_${eventId}`,
      content: 'CAPABILITY_PATH_EXCERPT',
      purgeAt: ingestPurgeAt,
    });
  }

  /**
   * Approve (unassigned) → createActiveAssignment → issueCapabilityForTask.
   * Does not change A6 approve semantics.
   */
  async function approveThenAssignCapability(suggestionId: string, eventId: string | null) {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion(suggestionId, eventId));
    const approved = await approveSuggestion(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/task-suggestions/${suggestionId}/approve`,
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', suggestionId, 1) },
      ),
      suggestionParams(suggestionId),
    );
    expect(approved.status).toBe(200);
    const body = await approved.json();
    expect(body.task.assignment).toBeUndefined();
    const suggestionRow = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    expect(suggestionRow.approvedTaskId).toBe(body.task.id);
    expect(suggestionRow.sourceCommunicationEventId).toBe(eventId);

    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: {
        id: asRecipientId(`rcp_${suggestionId}`),
        displayName: 'Capability Recipient',
        email: `${suggestionId}@example.com`,
        active: true,
      },
    });

    await createActiveAssignment(db.prisma, org, body.task.id, {
      id: asAssignmentId(`asg_${suggestionId}`),
      recipientId: asRecipientId(`rcp_${suggestionId}`),
      intendedRecipientEmail: `${suggestionId}@example.com`,
      assignedAt: now,
      assignedByOwnerId: asOwnerId(owner.ownerId),
      assignmentApprovedAt: now,
      allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
    });

    const issued = await issueCapabilityForTask({
      db: db.prisma,
      owner,
      taskId: body.task.id,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      pepper,
      appUrl,
      now,
      expectedVersion: body.task.version,
      capabilityId: `cap_${suggestionId}` as never,
    });

    return {
      taskId: body.task.id as string,
      token: issued.rawToken,
      version: issued.task.version,
      suggestionId,
    };
  }

  it('capability complete applies purgeAt = terminalAt + 7 days via approvedTaskId path', async () => {
    await seedEventWithExcerpt('evt_cap_d082', 'msg_cap_d082');
    const { taskId, token, version } = await approveThenAssignCapability(
      'sug_cap_d082',
      'evt_cap_d082',
    );

    const before = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_cap_d082');
    // Approve already applied the D082 30-day workflow ceiling (not the ingest window).
    expect(before?.purgeAt).toBe(computeWorkflowSafetyCeilingPurgeAt(now));
    expect(before?.content).toBe('CAPABILITY_PATH_EXCERPT');

    const response = await completeCapability(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/capabilities/${token}/tasks/${taskId}/complete`,
        { outcomeType: 'completed', confirmation: 'confirmed' },
        { 'if-match': formatETag('task', taskId, version) },
      ),
      capabilityParams(token, taskId),
    );
    expect(response.status).toBe(200);
    const taskBody = await response.json();
    expect(taskBody.status).toBe('completed');
    expect(JSON.stringify(taskBody)).not.toContain('CAPABILITY_PATH_EXCERPT');

    const after = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_cap_d082');
    expect(after?.purgeAt).toBe(computeExcerptPurgeAt(now));
    expect(after?.content).toBe('CAPABILITY_PATH_EXCERPT');
    expect(after?.purgedAt).toBeNull();
  });

  it('capability complete succeeds when excerpt is already purged', async () => {
    await seedEventWithExcerpt('evt_cap_purged', 'msg_cap_purged');
    const { taskId, token, version } = await approveThenAssignCapability(
      'sug_cap_purged',
      'evt_cap_purged',
    );
    await purgeTemporaryCommunicationExcerpt(db.prisma, org, 'evt_cap_purged', now);
    const purged = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_cap_purged',
    );
    expect(purged?.purgedAt).toBeTruthy();
    expect(purged?.content).toBe('');

    const response = await completeCapability(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/capabilities/${token}/tasks/${taskId}/complete`,
        { outcomeType: 'completed', confirmation: 'confirmed' },
        { 'if-match': formatETag('task', taskId, version) },
      ),
      capabilityParams(token, taskId),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('completed');

    const after = await getTemporaryCommunicationExcerptByEventId(db.prisma, org, 'evt_cap_purged');
    expect(after?.content).toBe('');
    expect(after?.purgedAt).toBeTruthy();
  });

  it('ordinary capability-completed Task without approved suggestion is unaffected', async () => {
    await upsertRecipient(db.prisma, {
      organizationId: org,
      recipient: {
        id: asRecipientId('rcp_ordinary_cap'),
        displayName: 'Ordinary',
        email: 'ordinary-cap@example.com',
        active: true,
      },
    });
    const created = await seedAssignedTaskViaService({
      db: db.prisma,
      org,
      owner,
      now,
      summaryPoints: [{ id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Ordinary' }],
      taskId: 'task_ordinary_cap',
      assignmentId: 'asg_ordinary_cap',
      recipientId: 'rcp_ordinary_cap',
      recipientEmail: 'ordinary-cap@example.com',
    });
    const issued = await issueCapabilityForTask({
      db: db.prisma,
      owner,
      taskId: created.task.id,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
      pepper,
      appUrl,
      now,
      expectedVersion: created.task.version,
      capabilityId: 'cap_ordinary_cap' as never,
    });

    const response = await completeCapability(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/capabilities/${issued.rawToken}/tasks/${created.task.id}/complete`,
        { outcomeType: 'completed', confirmation: 'confirmed' },
        { 'if-match': formatETag('task', created.task.id, issued.task.version) },
      ),
      capabilityParams(issued.rawToken, created.task.id),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('completed');
    expect(
      await db.prisma.taskSuggestion.count({
        where: { organizationId: org, approvedTaskId: created.task.id },
      }),
    ).toBe(0);
  });
});
