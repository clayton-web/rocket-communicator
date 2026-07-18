// @vitest-environment node
/**
 * A6.2 Owner task-suggestion HTTP surface
 * ---------------------------------------
 * GET  /api/v1/task-suggestions
 * GET  /api/v1/task-suggestions/{suggestionId}
 * POST /api/v1/task-suggestions/{suggestionId}/edit
 * POST /api/v1/task-suggestions/{suggestionId}/dismiss
 * POST /api/v1/task-suggestions/{suggestionId}/approve
 * POST /api/v1/task-suggestions/{suggestionId}/merge
 *
 * Plus D082 terminal retention via Owner Task complete/dismiss HTTP paths.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asCommunicationEventId,
  asOrganizationId,
  asOwnerId,
  asTaskId,
  asTaskSuggestionId,
  computeExcerptPurgeAt,
  createStandaloneTask,
  formatETag,
  ownerActor,
  type ParsedGmailMessageFixture,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  createOrUpdatePendingCommunicationAccount,
  createTask,
  createTaskSuggestion,
  getTemporaryCommunicationExcerptByEventId,
  listAuditEventsForTask,
  listTaskAssignments,
  persistConnectedCommunicationAccount,
  upsertCommunicationEvent,
  upsertTemporaryCommunicationExcerpt,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';

vi.mock('@/lib/auth/require-owner', () => ({
  getAuthenticatedOwner: vi.fn(),
}));

import { getAuthenticatedOwner } from '@/lib/auth/require-owner';
import { GET as listSuggestions } from '@/app/api/v1/task-suggestions/route';
import { GET as getSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/route';
import { POST as editSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/edit/route';
import { POST as dismissSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/dismiss/route';
import { POST as approveSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/approve/route';
import { POST as mergeSuggestion } from '@/app/api/v1/task-suggestions/[suggestionId]/merge/route';
import { POST as completeTask } from '@/app/api/v1/tasks/[taskId]/complete/route';
import { POST as dismissTask } from '@/app/api/v1/tasks/[taskId]/dismiss/route';

const org = 'org_http_sug';
const otherOrg = 'org_http_sug_other';
const now = '2026-07-17T15:00:00.000Z';
const ingestPurgeAt = '2026-07-24T15:00:00.000Z';
const owner = ownerActor(asOwnerId('owner_http_sug'), asOrganizationId(org));
const otherOwner = ownerActor(asOwnerId('owner_http_sug_other'), asOrganizationId(otherOrg));

function authOwner(actor = owner) {
  vi.mocked(getAuthenticatedOwner).mockResolvedValue({
    user: { id: actor.ownerId } as never,
    actor,
    session: {
      ownerId: actor.ownerId,
      organizationId: actor.organizationId,
      role: 'owner',
      displayName: 'Owner',
    },
  });
}

function params(suggestionId: string) {
  return { params: Promise.resolve({ suggestionId }) };
}

function taskParams(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
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

function summaryPoints() {
  return [
    {
      id: 'p1',
      kind: 'next_action',
      label: 'Act',
      order: 0,
      value: 'Do work',
    },
  ];
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
    summaryPoints: summaryPoints() as never,
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

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: 'thread_http_sug',
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

async function seedAccount(db: TestDatabase, organizationId = org, accountId = 'acct_http_sug') {
  await createOrUpdatePendingCommunicationAccount(db.prisma, {
    organizationId,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: `google-${organizationId}`,
  });
  await persistConnectedCommunicationAccount(db.prisma, {
    organizationId,
    accountId,
    emailAddress: 'owner@acme.example',
    externalAccountId: `google-${organizationId}`,
    connectedAt: now,
    historyId: 'hist_1',
  });
}

async function seedEventWithExcerpt(
  db: TestDatabase,
  eventId: string,
  providerMessageId: string,
  organizationId = org,
  accountId = 'acct_http_sug',
) {
  await upsertCommunicationEvent(db.prisma, {
    organizationId,
    accountId,
    message: inboxMessage({ eventId, providerMessageId }),
  });
  await upsertTemporaryCommunicationExcerpt(db.prisma, {
    organizationId,
    communicationEventId: eventId,
    excerptId: `ex_${eventId}`,
    content: 'RAW_EXCERPT_MUST_NOT_LEAK',
    purgeAt: ingestPurgeAt,
  });
}

describe('A6.2 Owner task-suggestion routes', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccount(db);
    await seedAccount(db, otherOrg, 'acct_http_sug_other');
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(() => {
    installDbTestRuntime(db.prisma);
    authOwner();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('denies unauthenticated list', async () => {
    vi.mocked(getAuthenticatedOwner).mockResolvedValue(null);
    const response = await listSuggestions(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions'),
    );
    expect(response.status).toBe(401);
  });

  it('lists empty page for authenticated Owner', async () => {
    const response = await listSuggestions(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates deterministically and hides cross-org suggestions', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_list_1', null));
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_list_2', null, {
        updatedAt: '2026-07-17T15:01:00.000Z',
      }),
    );
    await createTaskSuggestion(
      db.prisma,
      otherOrg,
      pendingSuggestion('sug_list_other', null, {
        organizationId: asOrganizationId(otherOrg),
      }),
    );

    const page1 = await listSuggestions(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions?limit=1'),
    );
    expect(page1.status).toBe(200);
    const body1 = await page1.json();
    expect(body1.items).toHaveLength(1);
    expect(body1.items[0].id).toBe('sug_list_2');
    expect(body1.nextCursor).toBeTruthy();
    expect(JSON.stringify(body1)).not.toContain('RAW_EXCERPT');

    const page2 = await listSuggestions(
      jsonRequest(
        'GET',
        `http://localhost/api/v1/task-suggestions?limit=1&cursor=${encodeURIComponent(body1.nextCursor)}`,
      ),
    );
    const body2 = await page2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].id).toBe('sug_list_1');
    expect(body2.items.every((item: { id: string }) => item.id !== 'sug_list_other')).toBe(true);
  });

  it('gets pending suggestion with strong ETag and rejects foreign org', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_get', null));
    const ok = await getSuggestion(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions/sug_get'),
      params('sug_get'),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBe(formatETag('task-suggestion', 'sug_get', 1));
    const body = await ok.json();
    expect(body.etag).toBe(formatETag('task-suggestion', 'sug_get', 1));
    expect(JSON.stringify(body)).not.toContain('RAW_EXCERPT');

    authOwner(otherOwner);
    const foreign = await getSuggestion(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions/sug_get'),
      params('sug_get'),
    );
    expect(foreign.status).toBe(404);
  });

  it('edit succeeds with If-Match and rejects missing/stale/weak ETags', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_edit', null));
    const missing = await editSuggestion(
      jsonRequest('POST', 'http://localhost/api/v1/task-suggestions/sug_edit/edit', {
        proposedPriority: 'high',
      }),
      params('sug_edit'),
    );
    expect(missing.status).toBe(428);

    const weak = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_edit/edit',
        { proposedPriority: 'high' },
        { 'if-match': `W/${formatETag('task-suggestion', 'sug_edit', 1)}` },
      ),
      params('sug_edit'),
    );
    expect(weak.status).toBe(412);

    const stale = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_edit/edit',
        { proposedPriority: 'high' },
        { 'if-match': formatETag('task-suggestion', 'sug_edit', 99) },
      ),
      params('sug_edit'),
    );
    expect(stale.status).toBe(412);

    const ok = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_edit/edit',
        { proposedPriority: 'high' },
        { 'if-match': formatETag('task-suggestion', 'sug_edit', 1) },
      ),
      params('sug_edit'),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.proposedPriority).toBe('high');
    expect(body.version).toBe(2);
    expect(body.etag).toBe(formatETag('task-suggestion', 'sug_edit', 2));
  });

  it('dismiss succeeds once and rejects terminal repeat', async () => {
    await seedEventWithExcerpt(db, 'evt_dismiss_http', 'msg_dismiss_http');
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_dismiss', 'evt_dismiss_http'),
    );

    const ok = await dismissSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_dismiss/dismiss',
        { reason: 'not relevant' },
        { 'if-match': formatETag('task-suggestion', 'sug_dismiss', 1) },
      ),
      params('sug_dismiss'),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe('dismissed');
    const excerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_dismiss_http',
    );
    expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(now));
    expect(excerpt?.content).toBe('RAW_EXCERPT_MUST_NOT_LEAK');
    expect(JSON.stringify(body)).not.toContain('RAW_EXCERPT');

    const repeat = await dismissSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_dismiss/dismiss',
        {},
        { 'if-match': formatETag('task-suggestion', 'sug_dismiss', 2) },
      ),
      params('sug_dismiss'),
    );
    expect(repeat.status).toBe(409);
  });

  it('approve creates unassigned Task only and rejects recipientId', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_approve', null));
    const suggestionVersionBefore = (
      await db.prisma.taskSuggestion.findUniqueOrThrow({ where: { id: 'sug_approve' } })
    ).version;
    const countsBefore = {
      tasks: await db.prisma.task.count({ where: { organizationId: org } }),
      assignments: await db.prisma.taskAssignment.count({ where: { organizationId: org } }),
      capabilities: await db.prisma.taskCapability.count({ where: { organizationId: org } }),
      events: await db.prisma.communicationEvent.count({ where: { organizationId: org } }),
      syncRuns: await db.prisma.gmailSyncRun.count({ where: { organizationId: org } }),
    };

    const rejected = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_approve/approve',
        {
          acknowledgement: 'suggestion_approved',
          recipientId: 'rcp_blocked',
        },
        { 'if-match': formatETag('task-suggestion', 'sug_approve', 1) },
      ),
      params('sug_approve'),
    );
    expect(rejected.status).toBe(400);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error.code).toBe('RECIPIENT_HANDOFF_NOT_AVAILABLE');
    expect(rejectedBody.error.requestId).toBeTruthy();
    const stillPending = await getSuggestion(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions/sug_approve'),
      params('sug_approve'),
    );
    expect((await stillPending.json()).status).toBe('pending');
    expect(
      (await db.prisma.taskSuggestion.findUniqueOrThrow({ where: { id: 'sug_approve' } })).version,
    ).toBe(suggestionVersionBefore);
    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(countsBefore.tasks);
    expect(await db.prisma.taskAssignment.count({ where: { organizationId: org } })).toBe(
      countsBefore.assignments,
    );
    expect(await db.prisma.taskCapability.count({ where: { organizationId: org } })).toBe(
      countsBefore.capabilities,
    );
    expect(await db.prisma.communicationEvent.count({ where: { organizationId: org } })).toBe(
      countsBefore.events,
    );
    expect(await db.prisma.gmailSyncRun.count({ where: { organizationId: org } })).toBe(
      countsBefore.syncRuns,
    );

    const ok = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_approve/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_approve', 1) },
      ),
      params('sug_approve'),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.suggestion.status).toBe('approved');
    expect(body.suggestion).not.toHaveProperty('sourceCommunicationEventId');
    expect(body.task.assignment).toBeUndefined();
    expect(body.task.status).toBe('open');
    expect(body.task.reminder).toEqual({ paused: false });
    const suggestionRow = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: 'sug_approve' },
    });
    expect(suggestionRow.approvedTaskId).toBe(body.task.id);
    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(
      countsBefore.tasks + 1,
    );
    const assignments = await listTaskAssignments(db.prisma, org, body.task.id);
    expect(assignments).toHaveLength(0);
    expect(await db.prisma.taskCapability.count({ where: { taskId: body.task.id } })).toBe(0);
    expect(await db.prisma.taskAssignment.count({ where: { taskId: body.task.id } })).toBe(0);
    const taskRow = await db.prisma.task.findUniqueOrThrow({ where: { id: body.task.id } });
    expect(taskRow.reminder).toEqual({ paused: false });
    const audits = await listAuditEventsForTask(db.prisma, org, body.task.id);
    expect(audits.some((a) => a.action === 'suggestion.approve')).toBe(true);

    const staleRetry = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_approve/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_approve', 1) },
      ),
      params('sug_approve'),
    );
    expect(staleRetry.status).toBe(409);
    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(
      countsBefore.tasks + 1,
    );
  });

  it('merge requires dual preconditions and bumps both versions', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_merge', null));
    const target = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_merge_target'),
        organizationId: asOrganizationId(org),
        summaryPoints: [
          { id: 't1', kind: 'next_action', label: 'Existing', order: 0, value: 'Keep' },
        ],
      }),
    );

    const missingTarget = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge/merge',
        { targetTaskId: target.id },
        { 'if-match': formatETag('task-suggestion', 'sug_merge', 1) },
      ),
      params('sug_merge'),
    );
    expect(missingTarget.status).toBe(428);

    const staleTarget = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge/merge',
        {
          targetTaskId: target.id,
          targetTaskIfMatch: formatETag('task', target.id, 99),
        },
        { 'if-match': formatETag('task-suggestion', 'sug_merge', 1) },
      ),
      params('sug_merge'),
    );
    expect(staleTarget.status).toBe(412);

    const staleSuggestion = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge/merge',
        {
          targetTaskId: target.id,
          targetTaskIfMatch: formatETag('task', target.id, target.version),
        },
        { 'if-match': formatETag('task-suggestion', 'sug_merge', 99) },
      ),
      params('sug_merge'),
    );
    expect(staleSuggestion.status).toBe(412);

    const ok = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge/merge',
        {
          targetTaskId: target.id,
          targetTaskIfMatch: formatETag('task', target.id, target.version),
          appendSummaryPoints: true,
        },
        { 'if-match': formatETag('task-suggestion', 'sug_merge', 1) },
      ),
      params('sug_merge'),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe('merged');
    expect(body.mergedIntoTaskId).toBe(target.id);
    expect(body.version).toBe(2);
    expect(body.etag).toBe(formatETag('task-suggestion', 'sug_merge', 2));

    const mergedTask = await db.prisma.task.findUniqueOrThrow({ where: { id: target.id } });
    expect(mergedTask.version).toBe(target.version + 1);
  });

  it('supports work-request suggestion with null sourceCommunicationEventId end-to-end', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_wr', null));
    const listed = await listSuggestions(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions'),
    );
    const listedBody = await listed.json();
    expect(listedBody.items.some((item: { id: string }) => item.id === 'sug_wr')).toBe(true);

    const edited = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_wr/edit',
        { proposedPriority: 'urgent' },
        { 'if-match': formatETag('task-suggestion', 'sug_wr', 1) },
      ),
      params('sug_wr'),
    );
    expect(edited.status).toBe(200);

    const approved = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_wr/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_wr', 2) },
      ),
      params('sug_wr'),
    );
    expect(approved.status).toBe(200);
  });

  it('Owner complete applies D082 terminal +7-day retention for approved-suggestion Task', async () => {
    await seedEventWithExcerpt(db, 'evt_term_complete', 'msg_term_complete');
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_term_complete', 'evt_term_complete'),
    );
    const approved = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_term_complete/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_term_complete', 1) },
      ),
      params('sug_term_complete'),
    );
    const approvedBody = await approved.json();
    const taskId = approvedBody.task.id as string;
    const taskVersion = approvedBody.task.version as number;

    const completed = await completeTask(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/tasks/${taskId}/complete`,
        { outcomeType: 'completed' },
        { 'if-match': formatETag('task', taskId, taskVersion) },
      ),
      taskParams(taskId),
    );
    expect(completed.status).toBe(200);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_term_complete',
    );
    expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(now));
  });

  it('Owner dismiss applies D082 terminal +7-day retention for approved-suggestion Task', async () => {
    await seedEventWithExcerpt(db, 'evt_term_dismiss', 'msg_term_dismiss');
    await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_term_dismiss', 'evt_term_dismiss'),
    );
    const approved = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_term_dismiss/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_term_dismiss', 1) },
      ),
      params('sug_term_dismiss'),
    );
    const approvedBody = await approved.json();
    const taskId = approvedBody.task.id as string;
    const taskVersion = approvedBody.task.version as number;

    const dismissed = await dismissTask(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/tasks/${taskId}/dismiss`,
        { reason: 'cancel' },
        { 'if-match': formatETag('task', taskId, taskVersion) },
      ),
      taskParams(taskId),
    );
    expect(dismissed.status).toBe(200);
    const excerpt = await getTemporaryCommunicationExcerptByEventId(
      db.prisma,
      org,
      'evt_term_dismiss',
    );
    expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(now));
  });

  it('ordinary Task complete is unaffected when no approved suggestion exists', async () => {
    const task = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_ordinary'),
        organizationId: asOrganizationId(org),
        summaryPoints: summaryPoints() as never,
      }),
    );
    const completed = await completeTask(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/tasks/${task.id}/complete`,
        { outcomeType: 'completed' },
        { 'if-match': formatETag('task', task.id, task.version) },
      ),
      taskParams(task.id),
    );
    expect(completed.status).toBe(200);
  });

  it('missing excerpt does not fail approved-suggestion Task complete', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_no_excerpt', null));
    const approved = await approveSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_no_excerpt/approve',
        { acknowledgement: 'suggestion_approved' },
        { 'if-match': formatETag('task-suggestion', 'sug_no_excerpt', 1) },
      ),
      params('sug_no_excerpt'),
    );
    const approvedBody = await approved.json();
    const completed = await completeTask(
      jsonRequest(
        'POST',
        `http://localhost/api/v1/tasks/${approvedBody.task.id}/complete`,
        { outcomeType: 'completed' },
        { 'if-match': formatETag('task', approvedBody.task.id, approvedBody.task.version) },
      ),
      taskParams(approvedBody.task.id),
    );
    expect(completed.status).toBe(200);
  });

  it('rejects invalid list cursor with structured 400', async () => {
    const response = await listSuggestions(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions?cursor=not-a-valid-cursor'),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.requestId).toBeTruthy();
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/prisma|sql|stack/);
  });

  it('GET ETag round-trips unchanged into edit/dismiss/approve/merge', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_etag_rt', null));
    const got = await getSuggestion(
      jsonRequest('GET', 'http://localhost/api/v1/task-suggestions/sug_etag_rt'),
      params('sug_etag_rt'),
    );
    const httpEtag = got.headers.get('etag');
    const body = await got.json();
    expect(httpEtag).toBe(body.etag);
    expect(httpEtag).toBe(formatETag('task-suggestion', 'sug_etag_rt', 1));

    const edited = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_etag_rt/edit',
        { proposedPriority: 'low' },
        { 'if-match': httpEtag! },
      ),
      params('sug_etag_rt'),
    );
    expect(edited.status).toBe(200);
  });

  it('merge missing suggestion If-Match returns 428 with PRECONDITION_REQUIRED', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_merge_miss', null));
    const target = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_merge_miss'),
        organizationId: asOrganizationId(org),
        summaryPoints: summaryPoints() as never,
      }),
    );
    const response = await mergeSuggestion(
      jsonRequest('POST', 'http://localhost/api/v1/task-suggestions/sug_merge_miss/merge', {
        targetTaskId: target.id,
        targetTaskIfMatch: formatETag('task', target.id, target.version),
      }),
      params('sug_merge_miss'),
    );
    expect(response.status).toBe(428);
    expect((await response.json()).error.code).toBe('PRECONDITION_REQUIRED');
  });

  it('merge rejects cross-organization target as not found', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_merge_xorg', null));
    const foreignTarget = await createTask(
      db.prisma,
      otherOrg,
      createStandaloneTask({
        actor: otherOwner,
        now,
        id: asTaskId('task_merge_xorg'),
        organizationId: asOrganizationId(otherOrg),
        summaryPoints: summaryPoints() as never,
      }),
    );
    const response = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge_xorg/merge',
        {
          targetTaskId: foreignTarget.id,
          targetTaskIfMatch: formatETag('task', foreignTarget.id, foreignTarget.version),
        },
        { 'if-match': formatETag('task-suggestion', 'sug_merge_xorg', 1) },
      ),
      params('sug_merge_xorg'),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('malformed and wrong-resource suggestion If-Match return 412 with PRECONDITION_FAILED', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_precond', null));
    const malformed = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_precond/edit',
        { proposedPriority: 'high' },
        { 'if-match': 'not-an-etag' },
      ),
      params('sug_precond'),
    );
    expect(malformed.status).toBe(412);
    expect((await malformed.json()).error.code).toBe('PRECONDITION_FAILED');

    const wrongResource = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_precond/edit',
        { proposedPriority: 'high' },
        { 'if-match': formatETag('task-suggestion', 'sug_other', 1) },
      ),
      params('sug_precond'),
    );
    expect(wrongResource.status).toBe(412);
    expect((await wrongResource.json()).error.code).toBe('PRECONDITION_FAILED');

    const taskKind = await editSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_precond/edit',
        { proposedPriority: 'high' },
        { 'if-match': formatETag('task', 'sug_precond', 1) },
      ),
      params('sug_precond'),
    );
    expect(taskKind.status).toBe(412);
    expect((await taskKind.json()).error.code).toBe('PRECONDITION_FAILED');
  });

  it('merge malformed targetTaskIfMatch returns 412', async () => {
    await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_merge_bad_etag', null));
    const target = await createTask(
      db.prisma,
      org,
      createStandaloneTask({
        actor: owner,
        now,
        id: asTaskId('task_merge_bad_etag'),
        organizationId: asOrganizationId(org),
        summaryPoints: summaryPoints() as never,
      }),
    );
    const response = await mergeSuggestion(
      jsonRequest(
        'POST',
        'http://localhost/api/v1/task-suggestions/sug_merge_bad_etag/merge',
        {
          targetTaskId: target.id,
          targetTaskIfMatch: 'W/"task-task_merge_bad_etag-v1"',
        },
        { 'if-match': formatETag('task-suggestion', 'sug_merge_bad_etag', 1) },
      ),
      params('sug_merge_bad_etag'),
    );
    expect(response.status).toBe(412);
    expect((await response.json()).error.code).toBe('PRECONDITION_FAILED');
  });
});
