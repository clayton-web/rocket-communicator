/**
 * Acceptance-time Owner responsibility-selection evidence (D168).
 *
 * Covers the evidence carrier itself and its atomic persistence inside the existing approve
 * transaction: affirmative Owner and Recipient selection, organization-scoped Recipient validation,
 * rejection of malformed kind/Recipient combinations, all-or-nothing commit with the canonical Task,
 * and the invariant that a Recipient selection is evidence only — never assignment, capability,
 * handoff, or delivery.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  asTaskSuggestionId,
  computeWorkflowSafetyCeilingPurgeAt,
  createStandaloneTask,
  ownerActor,
  type Recipient,
  type TaskSuggestion,
} from '@aicaa/domain';
import {
  PersistenceError,
  createRecipient,
  createTask,
  createTaskSuggestion,
  createResponsibilitySelection,
  getResponsibilitySelectionBySuggestionId,
  getResponsibilitySelectionByTaskId,
  persistApproveTaskSuggestion,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_rsel';
const otherOrg = 'org_rsel_other';
const now = '2026-08-11T18:00:00.000Z';
const ownerId = 'owner_rsel';
const owner = ownerActor(asOwnerId(ownerId), asOrganizationId(org));

function pendingSuggestion(id: string, organizationId = org): TaskSuggestion {
  return {
    id: asTaskSuggestionId(id),
    organizationId: asOrganizationId(organizationId),
    status: 'pending',
    summaryPoints: [{ id: 'sp1', kind: 'next_action', label: 'Act', order: 0, value: 'Follow up' }],
    voiceOriginated: false,
    sourceCommunicationEventId: null,
    retention: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  } as TaskSuggestion;
}

function recipientFixture(id: string, email: string): Recipient {
  return {
    id: asRecipientId(id),
    organizationId: asOrganizationId(org),
    displayName: 'Selected Person',
    email,
    active: true,
    createdAt: now,
    updatedAt: now,
  } as Recipient;
}

function taskFor(suggestion: TaskSuggestion, taskId: string, organizationId = org) {
  return createStandaloneTask({
    actor: ownerActor(asOwnerId(ownerId), asOrganizationId(organizationId)),
    now,
    id: asTaskId(taskId),
    organizationId: asOrganizationId(organizationId),
    summaryPoints: suggestion.summaryPoints,
  });
}

type SelectionInput = Parameters<typeof persistApproveTaskSuggestion>[0]['responsibilitySelection'];

/** An affirmative Owner selection — the default because approve now requires one (D168). */
function ownerSelection(taskId: string): SelectionInput {
  return {
    id: `tsrs_${taskId}`,
    partyKind: 'owner',
    selectedByOwnerId: ownerId,
    selectedAt: now,
  };
}

function approveInput(
  suggestion: TaskSuggestion,
  taskId: string,
  responsibilitySelection: SelectionInput = ownerSelection(taskId),
) {
  return {
    organizationId: org,
    expectedSuggestionVersion: 1,
    suggestion: { ...suggestion, status: 'approved' as const, version: 2, updatedAt: now },
    task: taskFor(suggestion, taskId),
    responsibilitySelection,
    excerptPurgeAt: computeWorkflowSafetyCeilingPurgeAt(now),
    audit: {
      id: `aud_${taskId}`,
      organizationId: org,
      actorKind: 'owner' as const,
      ownerId,
      action: 'suggestion.approve',
      outcome: 'succeeded' as const,
      recordedAt: now,
    },
  };
}

describe('D168 responsibility-selection evidence carrier', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.taskSuggestionResponsibilitySelection.deleteMany();
    await db.prisma.taskSuggestion.deleteMany();
    await db.prisma.task.deleteMany();
    await db.prisma.recipient.deleteMany();
  });

  it('records an affirmative Owner selection with truthful Owner attribution', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_owner'));
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_owner', {
        id: 'tsrs_owner',
        partyKind: 'owner',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    expect(result.responsibilitySelection).toMatchObject({
      id: 'tsrs_owner',
      organizationId: org,
      suggestionId: 'sug_owner',
      taskId: result.task.id,
      partyKind: 'owner',
      recipientId: null,
      selectedByOwnerId: ownerId,
      selectedAt: now,
    });

    // The affirmative signal is partyKind, never the absent recipient or absent assignment.
    const stored = await getResponsibilitySelectionBySuggestionId(db.prisma, org, 'sug_owner');
    expect(stored?.partyKind).toBe('owner');
    expect(await db.prisma.taskAssignment.count({ where: { taskId: result.task.id } })).toBe(0);
    expect(await db.prisma.recipient.count({ where: { organizationId: org } })).toBe(0);
  });

  it('records an affirmative Recipient selection naming the selected Recipient', async () => {
    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture('rcp_sel', 'selected@example.com'),
    });
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_rcp'));
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_rcp', {
        id: 'tsrs_rcp',
        partyKind: 'recipient',
        recipientId: 'rcp_sel',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    expect(result.responsibilitySelection).toMatchObject({
      partyKind: 'recipient',
      recipientId: 'rcp_sel',
      selectedByOwnerId: ownerId,
      taskId: result.task.id,
    });
    expect(await getResponsibilitySelectionByTaskId(db.prisma, org, result.task.id)).toMatchObject({
      partyKind: 'recipient',
      recipientId: 'rcp_sel',
    });
  });

  it('records Recipient selection as evidence only — no assignment, capability, or handoff', async () => {
    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture('rcp_nodeliver', 'nodeliver@example.com'),
    });
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_nodeliver'),
    );
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_nodeliver', {
        id: 'tsrs_nodeliver',
        partyKind: 'recipient',
        recipientId: 'rcp_nodeliver',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    expect(result.task.assignment).toBeUndefined();
    expect(await db.prisma.taskAssignment.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskCapability.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.handoffAttempt.count({ where: { organizationId: org } })).toBe(0);
    // Recording the selection leaves the canonical Task exactly as an unassigned approve Task.
    const taskRow = await db.prisma.task.findUniqueOrThrow({ where: { id: result.task.id } });
    expect(taskRow.status).toBe('open');
  });

  it('scopes Recipient selection to the organization and rolls the approval back', async () => {
    await db.prisma.recipient.create({
      data: {
        id: 'rcp_foreign',
        organizationId: otherOrg,
        displayName: 'Foreign',
        email: 'foreign@example.com',
        emailNormalized: 'foreign@example.com',
        active: true,
      },
    });
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_foreign'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_foreign', {
          id: 'tsrs_foreign',
          partyKind: 'recipient',
          recipientId: 'rcp_foreign',
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'NOT_FOUND' });

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
    const unchanged = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: 'sug_foreign' },
    });
    expect(unchanged.status).toBe('pending');
    expect(unchanged.version).toBe(1);
    expect(unchanged.approvedTaskId).toBeNull();
  });

  it('rejects an unknown Recipient and leaves no partial approval', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_unknown'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_unknown', {
          id: 'tsrs_unknown',
          partyKind: 'recipient',
          recipientId: 'rcp_missing',
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'NOT_FOUND' });

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
  });

  it('rejects Owner selection carrying a Recipient, atomically', async () => {
    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture('rcp_mixed', 'mixed@example.com'),
    });
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_mixed'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_mixed', {
          id: 'tsrs_mixed',
          partyKind: 'owner',
          recipientId: 'rcp_mixed',
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
      }),
    ).rejects.toMatchObject({
      name: 'PersistenceError',
      code: 'VALIDATION',
    } satisfies Partial<PersistenceError>);

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
    expect(
      (await db.prisma.taskSuggestion.findUniqueOrThrow({ where: { id: 'sug_mixed' } })).status,
    ).toBe('pending');
  });

  it('rejects Recipient selection without a Recipient, atomically', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_norcp'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_norcp', {
          id: 'tsrs_norcp',
          partyKind: 'recipient',
          recipientId: null,
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'VALIDATION' });

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
  });

  it('requires the approving Owner id for attribution', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_noowner'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_noowner', {
          id: 'tsrs_noowner',
          partyKind: 'owner',
          selectedByOwnerId: '   ',
          selectedAt: now,
        }),
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'VALIDATION' });

    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
  });

  it('leaves no evidence behind when the approval itself fails on a stale version', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_stale'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_stale', {
          id: 'tsrs_stale',
          partyKind: 'owner',
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
        expectedSuggestionVersion: 99,
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'OPTIMISTIC_CONCURRENCY' });

    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.auditEvent.count({ where: { id: 'aud_task_stale' } })).toBe(0);
  });

  it('refuses to approve at all when no selection is supplied (D168)', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_none'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_none'),
        // Overridden after the helper's default so this reproduces an untyped caller that omits
        // the selection entirely, rather than one that supplies an Owner choice.
        responsibilitySelection: undefined as unknown as SelectionInput,
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'VALIDATION' });

    // Nothing was approved and nothing was invented: no Task, no evidence, no audit.
    expect(await db.prisma.task.count({ where: { organizationId: org } })).toBe(0);
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
    expect(await db.prisma.auditEvent.count({ where: { id: 'aud_task_none' } })).toBe(0);
    const unchanged = await db.prisma.taskSuggestion.findUniqueOrThrow({
      where: { id: 'sug_none' },
    });
    expect(unchanged.status).toBe('pending');
    expect(unchanged.version).toBe(1);
    expect(unchanged.approvedTaskId).toBeNull();
    // Absence is never resolved into an Owner selection (D155, D164).
    expect(await getResponsibilitySelectionBySuggestionId(db.prisma, org, 'sug_none')).toBeNull();
  });

  it('records evidence on every successful approval, so success always carries proof', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_always'));
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_always'),
    });

    expect(result.suggestion.status).toBe('approved');
    expect(result.suggestion.approvedTaskId).toBe(result.task.id);
    expect(result.responsibilitySelection.partyKind).toBe('owner');
    expect(
      await getResponsibilitySelectionBySuggestionId(db.prisma, org, 'sug_always'),
    ).not.toBeNull();
    // Owner responsibility still means no external assignment (D164).
    expect(await db.prisma.taskAssignment.count({ where: { taskId: result.task.id } })).toBe(0);
  });

  it('preserves the D080 legacy recipientId rejection alongside the new concept', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_legacy'));

    await expect(
      persistApproveTaskSuggestion({
        db: db.prisma,
        ...approveInput(suggestion, 'task_legacy', {
          id: 'tsrs_legacy',
          partyKind: 'owner',
          selectedByOwnerId: ownerId,
          selectedAt: now,
        }),
        recipientId: 'rcp_legacy',
      }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_HANDOFF_NOT_AVAILABLE' });

    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
  });

  it('holds one initial selection per accepted proposal and per canonical Task', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_once'));
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_once', {
        id: 'tsrs_once',
        partyKind: 'owner',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    // A second selection for the same acceptance is a unique violation, not an amendment: this
    // carrier records the initial decision and must not accumulate responsibility history.
    await expect(
      createResponsibilitySelection(db.prisma, {
        id: 'tsrs_once_again',
        organizationId: org,
        suggestionId: 'sug_once',
        taskId: result.task.id,
        partyKind: 'owner',
        selectedByOwnerId: ownerId,
        selectedAt: '2026-08-12T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({ name: 'PersistenceError', code: 'UNIQUE_VIOLATION' });

    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(1);
  });

  it('rejects both inconsistent shapes at the database CHECK constraint', async () => {
    // FK targets are created directly rather than through approve, so these inserts are refused by
    // the CHECK constraint itself rather than by the unique key an approval would have consumed.
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_check'));
    const result = { task: await createTask(db.prisma, org, taskFor(suggestion, 'task_check')) };

    // Owner selection carrying a Recipient.
    await expect(
      db.pglite.query(
        `INSERT INTO task_suggestion_responsibility_selections (
           id, organization_id, suggestion_id, task_id, party_kind, recipient_id,
           selected_by_owner_id, selected_at
         ) VALUES ('tsrs_bad_owner', $1, 'sug_check', $2, 'owner', 'rcp_x', $3, $4)`,
        [org, result.task.id, ownerId, now],
      ),
    ).rejects.toThrow();

    // Recipient selection with no Recipient — the shape that would let absence masquerade as
    // an Owner selection.
    await expect(
      db.pglite.query(
        `INSERT INTO task_suggestion_responsibility_selections (
           id, organization_id, suggestion_id, task_id, party_kind, recipient_id,
           selected_by_owner_id, selected_at
         ) VALUES ('tsrs_bad_rcp', $1, 'sug_check', $2, 'recipient', NULL, $3, $4)`,
        [org, result.task.id, ownerId, now],
      ),
    ).rejects.toThrow();

    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(0);
  });

  it('refuses to delete an accepted proposal, Task, or Recipient that carries evidence', async () => {
    await createRecipient(db.prisma, {
      organizationId: org,
      recipient: recipientFixture('rcp_restrict', 'restrict@example.com'),
    });
    const suggestion = await createTaskSuggestion(
      db.prisma,
      org,
      pendingSuggestion('sug_restrict'),
    );
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_restrict', {
        id: 'tsrs_restrict',
        partyKind: 'recipient',
        recipientId: 'rcp_restrict',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    await expect(
      db.prisma.taskSuggestion.delete({ where: { id: 'sug_restrict' } }),
    ).rejects.toThrow();
    await expect(db.prisma.task.delete({ where: { id: result.task.id } })).rejects.toThrow();
    await expect(db.prisma.recipient.delete({ where: { id: 'rcp_restrict' } })).rejects.toThrow();
    expect(await db.prisma.taskSuggestionResponsibilitySelection.count()).toBe(1);
  });

  it('scopes reads to the organization', async () => {
    const suggestion = await createTaskSuggestion(db.prisma, org, pendingSuggestion('sug_scope'));
    const result = await persistApproveTaskSuggestion({
      db: db.prisma,
      ...approveInput(suggestion, 'task_scope', {
        id: 'tsrs_scope',
        partyKind: 'owner',
        selectedByOwnerId: ownerId,
        selectedAt: now,
      }),
    });

    expect(
      await getResponsibilitySelectionBySuggestionId(db.prisma, org, 'sug_scope'),
    ).not.toBeNull();
    expect(
      await getResponsibilitySelectionBySuggestionId(db.prisma, otherOrg, 'sug_scope'),
    ).toBeNull();
    expect(
      await getResponsibilitySelectionByTaskId(db.prisma, otherOrg, result.task.id),
    ).toBeNull();
  });

  it('enables deny-by-default RLS with no policies', async () => {
    const rows = await db.pglite.query<{
      relrowsecurity: boolean;
      policies: bigint;
    }>(
      `SELECT c.relrowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
       FROM pg_class c
       WHERE c.relname = 'task_suggestion_responsibility_selections'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.relrowsecurity).toBe(true);
    expect(Number(rows.rows[0]?.policies ?? -1)).toBe(0);
  });
});
