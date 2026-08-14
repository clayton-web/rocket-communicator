// @vitest-environment node
/**
 * D082 workflow-hold retention for Owner Review excerpts — Gmail Review (S7 / D179) and Google
 * Messages Review (D181) proved by the same suite, because they are one behaviour.
 *
 * Review proposals reach their excerpt through `TaskSuggestion.sourceExcerptId`, never through A6's
 * unique `sourceCommunicationEventId`, and the excerpt's deadline is the maximum still-valid
 * entitlement across every sibling proposal holding a claim on it.
 *
 * Every retention assertion below names a concrete `purgeAt`. "An update happened" is not the
 * property under test: a wrong deadline is exactly as much a retention defect as a missing one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MockInterpretationProvider,
  DEFAULT_INTERPRETATION_POLICY_VERSION,
  type InterpretationProvider,
  type InterpretationResult,
  type ProposedTask,
} from '@aicaa/ai';
import {
  asOrganizationId,
  asOwnerId,
  computeExcerptPurgeAt,
  computeWorkflowSafetyCeilingPurgeAt,
  ownerActor,
  type TaskSummaryPoint,
} from '@aicaa/domain';
import {
  getTemporaryCommunicationExcerptByEventId,
  purgeTemporaryCommunicationExcerpt,
  type DbClient,
} from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { interpretCapture, type InterpretationRequest } from '@/lib/interpretation/service';
import {
  approveOwnerSuggestion,
  dismissOwnerSuggestion,
  mergeOwnerSuggestion,
} from '@/lib/suggestions/mutations';
import { addOwnerTaskNote, completeOwnerTask, dismissOwnerTask } from '@/lib/tasks/mutations';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import {
  seedGmailAccount,
  seedGmailEventWithExcerpt,
  seedMessagesEventWithExcerpt,
  type SeededExcerpt,
} from './helpers/seed-review-excerpt';

const org = 'org_d082_review';
const owner = ownerActor(asOwnerId('owner_d082_review'), asOrganizationId(org));
const accountId = 'acct_d082_review';

/** A5 Gmail ingest, so a Gmail Review excerpt starts at the D078 `syncedAt + 7 days`. */
const syncedAt = '2026-08-01T12:00:00.000Z';
const gmailInitialPurgeAt = '2026-08-08T12:00:00.000Z';

/** The Owner Review instant shared by both sources, and the association it commits. */
const reviewedAt = '2026-08-03T12:00:00.000Z';
/** A Messages Review excerpt has no ingest, so its initial deadline is `reviewedAt + 7 days`. */
const messagesInitialPurgeAt = '2026-08-10T12:00:00.000Z';
const associationCeiling = '2026-09-02T12:00:00.000Z';

const dismissedAt = '2026-08-05T09:00:00.000Z';
const dismissalDeadline = '2026-08-12T09:00:00.000Z';
const approvedAt = '2026-08-06T09:00:00.000Z';
const approvalCeiling = '2026-09-05T09:00:00.000Z';
const unrelatedActivityAt = '2026-08-10T09:00:00.000Z';
const taskTerminalAt = '2026-08-11T09:00:00.000Z';
const taskTerminalDeadline = '2026-08-18T09:00:00.000Z';

const rawInput = 'Please send the revised quote and book the survey.';

class FailingInterpretationProvider implements InterpretationProvider {
  readonly name = 'failing-interpretation';
  calls = 0;

  async interpret(): Promise<InterpretationResult> {
    this.calls += 1;
    throw new Error('provider unavailable');
  }
}

function summaryPoint(value: string): TaskSummaryPoint {
  return { id: 'sp_1', kind: 'request', label: 'Request', order: 0, value } as TaskSummaryPoint;
}

function proposedTask(value: string): ProposedTask {
  return { summaryPoints: [summaryPoint(value)], peopleHints: [], deadlineExpression: null };
}

function interpretationResult(tasks: ProposedTask[]): InterpretationResult {
  return {
    tasks,
    policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
    modelVersion: 'mock-interpretation-model',
  };
}

async function readExcerpt(db: DbClient, eventId: string) {
  return getTemporaryCommunicationExcerptByEventId(db, org, eventId);
}

/**
 * The canonical A13 purge predicate, asked directly because the worker itself is not built yet.
 *
 * Writers are obliged to leave a correct concrete `purgeAt` regardless (D082), so what a test can
 * prove today is that the row becomes selectable by this predicate exactly when it should.
 */
async function isPurgeEligibleAt(
  db: TestDatabase,
  excerptId: string,
  at: string,
): Promise<boolean> {
  const rows = await db.prisma.temporaryCommunicationExcerpt.findMany({
    where: {
      id: excerptId,
      organizationId: org,
      purgedAt: null,
      purgeAt: { lte: new Date(at) },
    },
    select: { id: true },
  });
  return rows.length === 1;
}

/**
 * The two Review sources, described only by what genuinely differs: how their excerpt comes to
 * exist and therefore what its initial deadline is. Everything after association is shared law.
 */
type ReviewSource = {
  label: string;
  initialPurgeAt: string;
  seed: (db: TestDatabase, key: string) => Promise<SeededExcerpt>;
  request: (input: {
    key: string;
    seeded: SeededExcerpt;
    idempotencyKey: string;
  }) => InterpretationRequest;
};

const gmailReview: ReviewSource = {
  label: 'Gmail Review (S7)',
  initialPurgeAt: gmailInitialPurgeAt,
  seed: (db, key) =>
    seedGmailEventWithExcerpt(db.prisma, {
      organizationId: org,
      accountId,
      eventId: `evt_${key}`,
      providerMessageId: `msg_${key}`,
      excerptId: `ex_${key}`,
      content: rawInput,
      purgeAt: gmailInitialPurgeAt,
      internalDate: syncedAt,
    }),
  request: ({ key, seeded, idempotencyKey }) => ({
    organizationId: org,
    sourceKind: 'gmail',
    rawInput,
    idempotencyKey,
    requestId: `req_${key}`,
    capturedAt: syncedAt,
    timezone: null,
    gmailProvenance: {
      communicationEventId: seeded.eventId,
      providerMessageId: `msg_${key}`,
      providerThreadId: `thread_msg_${key}`,
      excerptId: seeded.excerptId,
      excerptByteLength: rawInput.length,
      subject: 'Action needed',
      fromAddress: 'sender@example.com',
      dedupeKey: `gmail:msg_${key}`,
    },
  }),
};

const messagesReview: ReviewSource = {
  label: 'Messages Review (D181)',
  initialPurgeAt: messagesInitialPurgeAt,
  seed: (db, key) =>
    seedMessagesEventWithExcerpt(db.prisma, {
      organizationId: org,
      eventId: `cmsg_${key}`,
      sourceOccurrenceId: `0|com.google.android.apps.messaging|${key}`,
      dedupeKey: key.padEnd(64, 'd').slice(0, 64),
      excerptId: `exm_${key}`,
      content: rawInput,
      purgeAt: messagesInitialPurgeAt,
      observedAt: reviewedAt,
    }),
  request: ({ key, seeded, idempotencyKey }) => ({
    organizationId: org,
    sourceKind: 'google_messages',
    rawInput,
    idempotencyKey,
    requestId: `req_${key}`,
    capturedAt: reviewedAt,
    timezone: null,
    messagesProvenance: {
      communicationEventId: seeded.eventId,
      sourceOccurrenceId: `0|com.google.android.apps.messaging|${key}`,
      excerptId: seeded.excerptId,
      excerptByteLength: rawInput.length,
      dedupeKey: key.padEnd(64, 'd').slice(0, 64),
    },
  }),
};

describe.each([gmailReview, messagesReview])(
  'D082 workflow hold — $label',
  (source: ReviewSource) => {
    let db: TestDatabase;

    beforeAll(async () => {
      db = await createTestDatabase();
      installDbTestRuntime(db.prisma);
      await seedGmailAccount(db.prisma, {
        organizationId: org,
        accountId,
        emailAddress: 'owner@acme.example',
        connectedAt: syncedAt,
      });
    });

    afterAll(async () => {
      clearDbTestRuntime();
      await db.close();
    });

    afterEach(() => {
      installDbTestRuntime(db.prisma);
    });

    /**
     * One Owner Review producing `proposalCount` proposals against a freshly seeded excerpt.
     *
     * Each case uses its own event, excerpt, and idempotency key rather than a shared fixture that
     * gets deleted, so a test can never observe another test's siblings — which in a suite about
     * sibling entitlement would be the one lie worth avoiding.
     */
    async function review(
      key: string,
      proposalCount: number,
    ): Promise<{ seeded: SeededExcerpt; suggestionIds: string[] }> {
      const seeded = await source.seed(db, key);
      const provider = new MockInterpretationProvider({
        result: interpretationResult(
          Array.from({ length: proposalCount }, (_, index) => proposedTask(`Proposal ${index}`)),
        ),
      });
      const result = await interpretCapture({
        db: db.prisma,
        request: source.request({ key, seeded, idempotencyKey: `idem_${key}` }),
        now: reviewedAt,
        deps: { provider },
      });
      expect(result.outcome).toBe('created');
      expect(result.suggestions).toHaveLength(proposalCount);
      for (const suggestion of result.suggestions) {
        expect(suggestion.sourceExcerptId).toBe(seeded.excerptId);
        expect(suggestion.sourceCommunicationEventId).toBeNull();
      }
      return { seeded, suggestionIds: result.suggestions.map((s) => s.id) };
    }

    async function approve(suggestionId: string, now = approvedAt): Promise<string> {
      const result = await approveOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId,
        now,
        expectedVersion: 1,
        responsibility: { responsibleParty: 'owner' },
      });
      return result.task.id;
    }

    it('leaves the initial deadline alone and creates no entitlement for zero proposals', async () => {
      const seeded = await source.seed(db, 'zero');
      const provider = new MockInterpretationProvider({ result: interpretationResult([]) });

      const result = await interpretCapture({
        db: db.prisma,
        request: source.request({ key: 'zero', seeded, idempotencyKey: 'idem_zero' }),
        now: reviewedAt,
        deps: { provider },
      });

      expect(result.occurrence.outcome).toBe('no_proposals');
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(source.initialPurgeAt);
      expect(
        await db.prisma.taskSuggestion.count({ where: { sourceExcerptId: seeded.excerptId } }),
      ).toBe(0);
    });

    it('holds the excerpt to associatedAt + 30 days for one pending proposal', async () => {
      const { seeded } = await review('pending', 1);

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(associationCeiling);
      expect(excerpt?.purgeAt).toBe(computeWorkflowSafetyCeilingPurgeAt(reviewedAt));
      expect(excerpt?.purgedAt).toBeNull();
      expect(excerpt?.content).toBe(rawInput);
    });

    it('applies the association hold in the same transaction as the proposals', async () => {
      const seeded = await source.seed(db, 'atomic');
      // A provider result that persistence will refuse: an occurrence cannot commit proposals whose
      // policy version does not fit its column, so the whole transaction rolls back.
      const provider = new MockInterpretationProvider({
        result: {
          tasks: [proposedTask('Proposal')],
          policyVersion: 'p'.repeat(300),
          modelVersion: 'mock-interpretation-model',
        },
      });

      await expect(
        interpretCapture({
          db: db.prisma,
          request: source.request({ key: 'atomic', seeded, idempotencyKey: 'idem_atomic' }),
          now: reviewedAt,
          deps: { provider },
        }),
      ).rejects.toThrow();

      expect(
        await db.prisma.taskSuggestion.count({ where: { sourceExcerptId: seeded.excerptId } }),
      ).toBe(0);
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(source.initialPurgeAt);
    });

    it('keeps the excerpt past its original seven-day boundary while a proposal is pending', async () => {
      const { seeded } = await review('boundary', 1);
      const justPastInitial = new Date(Date.parse(source.initialPurgeAt) + 1).toISOString();

      expect(await isPurgeEligibleAt(db, seeded.excerptId, justPastInitial)).toBe(false);
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(associationCeiling);
      expect(excerpt?.purgedAt).toBeNull();
      expect(excerpt?.content).toBe(rawInput);
    });

    it('replaces the hold with dismissedAt + 7 days on dismiss', async () => {
      const { seeded, suggestionIds } = await review('dismiss', 1);

      await dismissOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[0]!,
        now: dismissedAt,
        expectedVersion: 1,
      });

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(dismissalDeadline);
      expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(dismissedAt));
    });

    it('replaces the hold with mergedAt + 7 days on merge', async () => {
      const { seeded, suggestionIds } = await review('merge', 2);
      const targetTaskId = await approve(suggestionIds[0]!);
      const target = await db.prisma.task.findUniqueOrThrow({ where: { id: targetTaskId } });

      await mergeOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[1]!,
        now: '2026-09-20T09:00:00.000Z',
        expectedVersion: 1,
        targetTaskId,
        targetTaskExpectedVersion: target.version,
      });

      // Later than the approved sibling's ceiling, so the merge value is the visible maximum.
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt('2026-09-20T09:00:00.000Z'));
    });

    it('writes approvedAt + 30 days once on approve', async () => {
      const { seeded, suggestionIds } = await review('approve', 1);

      await approve(suggestionIds[0]!);

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(approvalCeiling);
      expect(excerpt?.purgeAt).toBe(computeWorkflowSafetyCeilingPurgeAt(approvedAt));
    });

    it('does not refresh the approval ceiling when the resulting Task sees unrelated activity', async () => {
      const { seeded, suggestionIds } = await review('no_refresh', 1);
      const taskId = await approve(suggestionIds[0]!);
      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });

      await addOwnerTaskNote({
        db: db.prisma,
        owner,
        taskId,
        now: unrelatedActivityAt,
        expectedVersion: task.version,
        body: 'Chasing this up.',
      });

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(approvalCeiling);
    });

    it('replaces the ceiling with taskTerminalAt + 7 days when the Task completes', async () => {
      const { seeded, suggestionIds } = await review('complete', 1);
      const taskId = await approve(suggestionIds[0]!);
      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });

      await completeOwnerTask({
        db: db.prisma,
        owner,
        taskId,
        now: taskTerminalAt,
        expectedVersion: task.version,
        outcomeType: 'completed',
      });

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(taskTerminalDeadline);
      expect(excerpt?.purgeAt).toBe(computeExcerptPurgeAt(taskTerminalAt));
      expect(excerpt?.content).toBe(rawInput);
    });

    it('replaces the ceiling with taskTerminalAt + 7 days when the Task is dismissed', async () => {
      const { seeded, suggestionIds } = await review('task_dismiss', 1);
      const taskId = await approve(suggestionIds[0]!);
      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });

      await dismissOwnerTask({
        db: db.prisma,
        owner,
        taskId,
        now: taskTerminalAt,
        expectedVersion: task.version,
      });

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(taskTerminalDeadline);
    });

    it('keeps the approved sibling entitlement when its dismissed sibling would shorten it', async () => {
      const { seeded, suggestionIds } = await review('siblings', 2);

      await dismissOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[0]!,
        now: dismissedAt,
        expectedVersion: 1,
      });

      // The still-pending sibling's association ceiling outlives the dismissal window, so one
      // sibling's terminal transition does not pull the excerpt out from under the other.
      let excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(associationCeiling);

      await approve(suggestionIds[1]!);

      excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(approvalCeiling);
      expect(Date.parse(excerpt!.purgeAt)).toBeGreaterThan(Date.parse(dismissalDeadline));
    });

    it('shortens to the maximum remaining entitlement once every sibling is terminal', async () => {
      const { seeded, suggestionIds } = await review('both_terminal', 2);

      await dismissOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[0]!,
        now: dismissedAt,
        expectedVersion: 1,
      });
      const taskId = await approve(suggestionIds[1]!);
      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect((await readExcerpt(db.prisma, seeded.eventId))?.purgeAt).toBe(approvalCeiling);

      await completeOwnerTask({
        db: db.prisma,
        owner,
        taskId,
        now: taskTerminalAt,
        expectedVersion: task.version,
        outcomeType: 'completed',
      });

      // max(dismissedAt + 7d, taskTerminalAt + 7d) — shorter than the ceiling it replaces, which is
      // the shortening D082 permits once no longer entitlement survives.
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(taskTerminalDeadline);
      expect(Date.parse(excerpt!.purgeAt)).toBeLessThan(Date.parse(approvalCeiling));
      expect(Date.parse(excerpt!.purgeAt)).toBeGreaterThan(Date.parse(dismissalDeadline));
    });

    it('keeps a longer sibling entitlement even when the last transition writes a shorter one', async () => {
      const { seeded, suggestionIds } = await review('last_writer', 2);
      const lateDismissedAt = '2026-08-30T09:00:00.000Z';
      const lateDismissalDeadline = computeExcerptPurgeAt(lateDismissedAt);

      await dismissOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[0]!,
        now: lateDismissedAt,
        expectedVersion: 1,
      });
      expect((await readExcerpt(db.prisma, seeded.eventId))?.purgeAt).toBe(lateDismissalDeadline);

      // Both remaining transitions produce entitlements *shorter* than the dismissed sibling's, so
      // an implementation that simply wrote the transitioning proposal's own value would shorten the
      // excerpt below a claim that is still valid.
      const taskId = await approve(suggestionIds[1]!);
      expect((await readExcerpt(db.prisma, seeded.eventId))?.purgeAt).toBe(lateDismissalDeadline);

      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      await completeOwnerTask({
        db: db.prisma,
        owner,
        taskId,
        now: taskTerminalAt,
        expectedVersion: task.version,
        outcomeType: 'completed',
      });

      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(lateDismissalDeadline);
      expect(Date.parse(excerpt!.purgeAt)).toBeGreaterThan(Date.parse(taskTerminalDeadline));
    });

    it('never restores or re-dates an already-purged excerpt', async () => {
      const { seeded, suggestionIds } = await review('purged', 1);
      await purgeTemporaryCommunicationExcerpt(db.prisma, org, seeded.eventId, dismissedAt);
      const purged = await readExcerpt(db.prisma, seeded.eventId);
      expect(purged?.purgedAt).toBe(dismissedAt);
      expect(purged?.content).toBe('');
      const purgedDeadline = purged!.purgeAt;

      const taskId = await approve(suggestionIds[0]!);
      const task = await db.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      await completeOwnerTask({
        db: db.prisma,
        owner,
        taskId,
        now: taskTerminalAt,
        expectedVersion: task.version,
        outcomeType: 'completed',
      });

      const after = await readExcerpt(db.prisma, seeded.eventId);
      expect(after?.purgedAt).toBe(dismissedAt);
      expect(after?.content).toBe('');
      expect(after?.purgeAt).toBe(purgedDeadline);
    });

    it('creates no new entitlement and does not refresh purgeAt on an exact D161 replay', async () => {
      const seeded = await source.seed(db, 'replay');
      const provider = new MockInterpretationProvider({
        result: interpretationResult([proposedTask('Proposal')]),
      });
      const request = source.request({ key: 'replay', seeded, idempotencyKey: 'idem_replay' });

      const first = await interpretCapture({
        db: db.prisma,
        request,
        now: reviewedAt,
        deps: { provider },
      });
      expect(first.outcome).toBe('created');
      expect((await readExcerpt(db.prisma, seeded.eventId))?.purgeAt).toBe(associationCeiling);

      const replay = await interpretCapture({
        db: db.prisma,
        request,
        // A much later replay would move the deadline if replay created an association.
        now: '2026-08-20T12:00:00.000Z',
        deps: { provider },
      });

      expect(replay.outcome).toBe('replayed');
      expect(
        await db.prisma.taskSuggestion.count({ where: { sourceExcerptId: seeded.excerptId } }),
      ).toBe(1);
      expect(
        await db.prisma.interpretationRun.count({ where: { idempotencyKey: 'idem_replay' } }),
      ).toBe(1);
      expect((await readExcerpt(db.prisma, seeded.eventId))?.purgeAt).toBe(associationCeiling);
    });

    it('leaves the initial deadline in place when the provider fails before any commit', async () => {
      const seeded = await source.seed(db, 'provider_fail');
      const provider = new FailingInterpretationProvider();

      await expect(
        interpretCapture({
          db: db.prisma,
          request: source.request({
            key: 'provider_fail',
            seeded,
            idempotencyKey: 'idem_provider_fail',
          }),
          now: reviewedAt,
          deps: { provider },
        }),
      ).rejects.toThrow();

      expect(provider.calls).toBe(1);
      expect(
        await db.prisma.interpretationRun.count({
          where: { idempotencyKey: 'idem_provider_fail' },
        }),
      ).toBe(0);
      expect(
        await db.prisma.taskSuggestion.count({ where: { sourceExcerptId: seeded.excerptId } }),
      ).toBe(0);
      const excerpt = await readExcerpt(db.prisma, seeded.eventId);
      expect(excerpt?.purgeAt).toBe(source.initialPurgeAt);
    });

    it('becomes purge-eligible once the resolved deadline passes', async () => {
      const { seeded, suggestionIds } = await review('eligible', 1);
      await dismissOwnerSuggestion({
        db: db.prisma,
        owner,
        suggestionId: suggestionIds[0]!,
        now: dismissedAt,
        expectedVersion: 1,
      });

      const oneMsBefore = new Date(Date.parse(dismissalDeadline) - 1).toISOString();
      expect(await isPurgeEligibleAt(db, seeded.excerptId, oneMsBefore)).toBe(false);
      expect(await isPurgeEligibleAt(db, seeded.excerptId, dismissalDeadline)).toBe(true);

      await purgeTemporaryCommunicationExcerpt(db.prisma, org, seeded.eventId, dismissalDeadline);
      expect(await isPurgeEligibleAt(db, seeded.excerptId, dismissalDeadline)).toBe(false);
    });
  },
);

describe('D082 manual capture stays outside temporary communication retention', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    installDbTestRuntime(db.prisma);
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  it('persists no CommunicationEvent, no excerpt, and no excerpt linkage', async () => {
    const provider = new MockInterpretationProvider({
      result: interpretationResult([proposedTask('Call the surveyor'), proposedTask('Send quote')]),
    });

    const result = await interpretCapture({
      db: db.prisma,
      request: {
        organizationId: org,
        sourceKind: 'owner_manual_capture',
        rawInput: 'Call the surveyor and send the quote.',
        idempotencyKey: 'idem_manual_d082',
        requestId: 'req_manual_d082',
        capturedAt: reviewedAt,
        timezone: null,
      },
      now: reviewedAt,
      deps: { provider },
    });

    expect(result.suggestions).toHaveLength(2);
    for (const suggestion of result.suggestions) {
      expect(suggestion.sourceExcerptId).toBeNull();
      expect(suggestion.sourceCommunicationEventId).toBeNull();
      expect(suggestion.sourceReference?.excerptRef).toBeUndefined();
    }
    expect(await db.prisma.communicationEvent.count()).toBe(0);
    expect(await db.prisma.temporaryCommunicationExcerpt.count()).toBe(0);
    expect(
      await db.prisma.taskSuggestion.count({ where: { sourceExcerptId: { not: null } } }),
    ).toBe(0);
  });
});
