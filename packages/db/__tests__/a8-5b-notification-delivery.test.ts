/**
 * A8.5b delivery state machine and claim protocol (D133, D135).
 *
 * PGlite establishes the deterministic transitions and every invariant the database enforces on a
 * single connection: what each settlement writes, what the CHECK constraints refuse, and that a
 * stale fence changes nothing. It cannot establish that two workers racing one intent produce one
 * transport call, because one connection makes them sequential and they always agree. That is
 * `a8-5b-notification-concurrency.pg.test.ts`, and a skipped run of it is not evidence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  beginOwnerNotificationAttempt,
  claimOwnerNotificationIntent,
  createOwnerNotificationIntent,
  findOwnerNotificationIntentById,
  listClaimableOwnerNotificationIntents,
  listExpiredOwnerNotificationClaims,
  listInFlightOwnerNotificationAttempts,
  listOwnerNotificationAttempts,
  recoverExpiredOwnerNotificationClaim,
  settleOwnerNotificationAttempt,
  terminalizeOwnerNotificationWithoutDelivery,
  type CreateOwnerNotificationIntentInput,
  type OwnerNotificationSettlement,
} from '../src/index.js';
import type { CreateAuditEventInput } from '../src/repositories/audit-repository.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_a85b';
const occurredAt = '2026-08-04T09:00:00.000Z';
const claimedAt = '2026-08-04T09:05:00.000Z';
const expiresAt = '2026-08-04T09:07:00.000Z';
const settledAt = '2026-08-04T09:05:30.000Z';

function intentInput(
  overrides: Partial<CreateOwnerNotificationIntentInput> = {},
): CreateOwnerNotificationIntentInput {
  return {
    id: 'onint_1',
    organizationId: org,
    eventType: 'task_completed_by_recipient',
    subjectKind: 'task',
    subjectId: 'task_1',
    occurrenceKey: '4',
    occurredAt,
    actorKind: 'capability',
    ownerId: null,
    capabilityId: 'cap_1',
    systemId: null,
    assignmentId: 'asg_1',
    attributionLabel: null,
    auditEventId: 'audit_trigger_1',
    requestId: 'req_1',
    correlationId: 'corr_1',
    ...overrides,
  };
}

function systemAudit(overrides: Partial<CreateAuditEventInput> = {}): CreateAuditEventInput {
  return {
    id: `audit_${Math.random().toString(36).slice(2, 10)}`,
    organizationId: org,
    actorKind: 'system',
    systemId: 'owner_notification_process',
    taskId: 'task_1',
    action: 'owner_notification.sent',
    outcome: 'succeeded',
    recordedAt: settledAt,
    ...overrides,
  };
}

describe('A8.5b owner notification delivery', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.prisma.ownerNotificationAttempt.deleteMany();
    await db.prisma.ownerNotificationIntent.deleteMany();
    await db.prisma.auditEvent.deleteMany();
  });

  /** Seed one pending intent and take its lease, returning the fence. */
  async function seedClaimed(overrides: Partial<CreateOwnerNotificationIntentInput> = {}) {
    const intent = await createOwnerNotificationIntent(db.prisma, intentInput(overrides));
    const claim = await claimOwnerNotificationIntent(db.prisma, {
      id: intent.id,
      organizationId: org,
      expectedClaimSequence: intent.claimSequence,
      claimedBy: 'notification_process:req_1',
      claimedAt,
      claimExpiresAt: expiresAt,
    });
    if (!claim.claimed) {
      throw new Error('seed claim failed');
    }
    return { intent, claimSequence: claim.claimSequence };
  }

  /** Seed a claimed intent that has an open in-flight attempt. */
  async function seedInFlight(overrides: Partial<CreateOwnerNotificationIntentInput> = {}) {
    const { intent, claimSequence } = await seedClaimed(overrides);
    const began = await beginOwnerNotificationAttempt(db.prisma, {
      attemptId: `onatt_${intent.id}`,
      intentId: intent.id,
      organizationId: org,
      claimSequence,
      expectedAttemptCount: 0,
      startedAt: claimedAt,
    });
    if (!began.began) {
      throw new Error('seed attempt failed');
    }
    return { intent, claimSequence, attempt: began.attempt };
  }

  describe('scanning', () => {
    it('returns only pending intents, oldest event first', async () => {
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({ id: 'onint_late', occurrenceKey: '9', occurredAt: '2026-08-04T11:00:00Z' }),
      );
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({ id: 'onint_early', occurrenceKey: '8', occurredAt: '2026-08-04T08:00:00Z' }),
      );
      await seedClaimed({ id: 'onint_busy', occurrenceKey: '7' });

      const claimable = await listClaimableOwnerNotificationIntents(db.prisma, { limit: 25 });

      expect(claimable.map((row) => row.id)).toEqual(['onint_early', 'onint_late']);
    });

    it('honours the batch bound and refuses an unreasonable one', async () => {
      for (let index = 0; index < 4; index += 1) {
        await createOwnerNotificationIntent(
          db.prisma,
          intentInput({ id: `onint_${index}`, occurrenceKey: String(index) }),
        );
      }

      expect(await listClaimableOwnerNotificationIntents(db.prisma, { limit: 2 })).toHaveLength(2);
      await expect(
        listClaimableOwnerNotificationIntents(db.prisma, { limit: 0 }),
      ).rejects.toThrowError(/between 1 and 500/);
    });

    it('finds only leases that have actually lapsed', async () => {
      await seedClaimed();

      expect(
        await listExpiredOwnerNotificationClaims(db.prisma, {
          now: '2026-08-04T09:06:00.000Z',
          limit: 25,
        }),
      ).toHaveLength(0);
      expect(
        await listExpiredOwnerNotificationClaims(db.prisma, {
          now: '2026-08-04T09:08:00.000Z',
          limit: 25,
        }),
      ).toHaveLength(1);
    });
  });

  describe('claiming', () => {
    it('takes the lease and advances the fence', async () => {
      const intent = await createOwnerNotificationIntent(db.prisma, intentInput());
      expect(intent.claimSequence).toBe(0);

      const claim = await claimOwnerNotificationIntent(db.prisma, {
        id: intent.id,
        organizationId: org,
        expectedClaimSequence: 0,
        claimedBy: 'worker_a',
        claimedAt,
        claimExpiresAt: expiresAt,
      });

      expect(claim).toEqual({ claimed: true, claimSequence: 1 });
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
      expect(after?.claimedBy).toBe('worker_a');
      expect(after?.claimExpiresAt).toBe(expiresAt);
      expect(after?.settledAt).toBeNull();
    });

    it('refuses a second claim while the first holds the lease', async () => {
      const { intent } = await seedClaimed();

      const second = await claimOwnerNotificationIntent(db.prisma, {
        id: intent.id,
        organizationId: org,
        expectedClaimSequence: 0,
        claimedBy: 'worker_b',
        claimedAt,
        claimExpiresAt: expiresAt,
      });

      expect(second).toEqual({ claimed: false, reason: 'lost' });
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.claimedBy).toBe('notification_process:req_1');
    });

    it('refuses a claim whose observed fence is stale', async () => {
      const intent = await createOwnerNotificationIntent(db.prisma, intentInput());

      // Someone claimed and released between the scan and this attempt, so the sequence moved.
      await claimOwnerNotificationIntent(db.prisma, {
        id: intent.id,
        organizationId: org,
        expectedClaimSequence: 0,
        claimedBy: 'worker_a',
        claimedAt,
        claimExpiresAt: expiresAt,
      });
      await recoverExpiredOwnerNotificationClaim(db.prisma, {
        id: intent.id,
        organizationId: org,
        claimSequence: 1,
      });

      const stale = await claimOwnerNotificationIntent(db.prisma, {
        id: intent.id,
        organizationId: org,
        expectedClaimSequence: 0,
        claimedBy: 'worker_b',
        claimedAt,
        claimExpiresAt: expiresAt,
      });

      expect(stale).toEqual({ claimed: false, reason: 'lost' });
    });

    it('never claims a terminal intent', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();
      await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: { kind: 'failed_permanent', failureCode: 'rejected' },
        settledAt,
        audit: systemAudit({ action: 'owner_notification.failed_permanent', outcome: 'failed' }),
      });

      const reclaim = await claimOwnerNotificationIntent(db.prisma, {
        id: intent.id,
        organizationId: org,
        expectedClaimSequence: claimSequence,
        claimedBy: 'worker_b',
        claimedAt,
        claimExpiresAt: expiresAt,
      });

      expect(reclaim).toEqual({ claimed: false, reason: 'lost' });
      expect(await listClaimableOwnerNotificationIntents(db.prisma, { limit: 25 })).toHaveLength(0);
    });
  });

  describe('the in-flight marker', () => {
    it('numbers attempts from the intent count and records the call start', async () => {
      const { intent, claimSequence } = await seedClaimed();

      const began = await beginOwnerNotificationAttempt(db.prisma, {
        attemptId: 'onatt_1',
        intentId: intent.id,
        organizationId: org,
        claimSequence,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });

      expect(began.began).toBe(true);
      if (!began.began) {
        return;
      }
      expect(began.attempt.attemptNumber).toBe(1);
      expect(began.attempt.outcome).toBe('in_flight');
      expect(began.attempt.providerCallStartedAt).toBe(claimedAt);
      expect(began.attempt.providerAcceptedAt).toBeNull();

      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.attemptCount).toBe(1);
    });

    it('refuses to open an attempt against a superseded fence', async () => {
      const { intent, claimSequence } = await seedClaimed();

      const began = await beginOwnerNotificationAttempt(db.prisma, {
        attemptId: 'onatt_stale',
        intentId: intent.id,
        organizationId: org,
        claimSequence: claimSequence - 1,
        expectedAttemptCount: 0,
        startedAt: claimedAt,
      });

      expect(began).toEqual({ began: false, reason: 'lost' });
      expect(await listOwnerNotificationAttempts(db.prisma, intent.id)).toHaveLength(0);
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.attemptCount).toBe(0);
    });
  });

  describe('settlement', () => {
    it('records a delivery with its acceptance proof', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      const settled = await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: {
          kind: 'sent',
          providerMessageRef: 'fake-msg-1',
          providerAcceptedAt: settledAt,
        },
        settledAt,
        audit: systemAudit(),
      });

      expect(settled.settled).toBe(true);
      if (!settled.settled) {
        return;
      }
      expect(settled.intent.state).toBe('sent');
      expect(settled.intent.settledAt).toBe(settledAt);
      expect(settled.intent.failureCode).toBeNull();
      // The lease is gone: `claim_only_when_claimed` requires it of every non-claimed state.
      expect(settled.intent.claimedBy).toBeNull();
      expect(settled.intent.claimExpiresAt).toBeNull();
      expect(settled.attempt.outcome).toBe('sent');
      expect(settled.attempt.providerMessageRef).toBe('fake-msg-1');
      expect(settled.attempt.providerAcceptedAt).toBe(settledAt);
    });

    it('returns a retryable failure to claimable work without a settlement instant', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      const settled = await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: { kind: 'retry', failureCode: 'transient' },
        settledAt,
      });

      expect(settled.settled).toBe(true);
      if (!settled.settled) {
        return;
      }
      expect(settled.intent.state).toBe('pending');
      expect(settled.intent.settledAt).toBeNull();
      // `failure_code_matches_state` refuses a code on a pending row; the attempt carries it.
      expect(settled.intent.failureCode).toBeNull();
      expect(settled.intent.attemptCount).toBe(1);
      expect(settled.attempt.outcome).toBe('failed_retryable');
      expect(settled.attempt.failureCode).toBe('transient');

      // Back on the partial pending index, which is the whole reason it returns here.
      expect(await listClaimableOwnerNotificationIntents(db.prisma, { limit: 25 })).toHaveLength(1);
    });

    it.each([
      ['exhausted', 'requires_owner_attention', 'retry_budget_exhausted'],
      ['failed_permanent', 'failed_permanent', 'rejected'],
      ['ambiguous', 'ambiguous', 'no_answer'],
    ] as const)('terminalizes %s as %s', async (kind, expectedState, failureCode) => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      const settled = await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: { kind, failureCode } as OwnerNotificationSettlement,
        settledAt,
        audit: systemAudit({ action: `owner_notification.${kind}`, outcome: 'failed' }),
      });

      expect(settled.settled).toBe(true);
      if (!settled.settled) {
        return;
      }
      expect(settled.intent.state).toBe(expectedState);
      expect(settled.intent.settledAt).toBe(settledAt);
      expect(settled.intent.failureCode).toBe(failureCode);
      expect(settled.intent.claimedBy).toBeNull();
      // Never reported as delivered, and carrying no acceptance proof.
      expect(settled.attempt.outcome).not.toBe('sent');
      expect(settled.attempt.providerAcceptedAt).toBeNull();
      expect(settled.attempt.providerMessageRef).toBeNull();
    });

    it('refuses to settle on a superseded fence and changes nothing', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      const settled = await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence: claimSequence - 1,
        settlement: { kind: 'sent', providerMessageRef: 'ghost', providerAcceptedAt: settledAt },
        settledAt,
        audit: systemAudit(),
      });

      expect(settled).toEqual({ settled: false, reason: 'lost' });
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
      expect(await listInFlightOwnerNotificationAttempts(db.prisma, intent.id)).toHaveLength(1);
      expect(await db.prisma.auditEvent.count()).toBe(0);
    });

    it('cannot settle the same provider call twice', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();
      const settlement = {
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: { kind: 'ambiguous', failureCode: 'no_answer' } as OwnerNotificationSettlement,
        settledAt,
        audit: systemAudit({ action: 'owner_notification.ambiguous', outcome: 'failed' }),
      };

      expect((await settleOwnerNotificationAttempt(settlement)).settled).toBe(true);
      expect((await settleOwnerNotificationAttempt(settlement)).settled).toBe(false);
      expect(await db.prisma.auditEvent.count()).toBe(1);
    });

    it('refuses a terminal settlement with no audit event', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      await expect(
        settleOwnerNotificationAttempt({
          db: db.prisma,
          intentId: intent.id,
          organizationId: org,
          attemptId: attempt.id,
          claimSequence,
          settlement: {
            kind: 'sent',
            providerMessageRef: 'fake-msg-1',
            providerAcceptedAt: settledAt,
          },
          settledAt,
        }),
      ).rejects.toThrowError(/requires an audit event/);
    });
  });

  describe('audit', () => {
    it('attributes the delivery to the system, never to the actor that caused the event', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: {
          kind: 'sent',
          providerMessageRef: 'fake-msg-1',
          providerAcceptedAt: settledAt,
        },
        settledAt,
        audit: systemAudit(),
      });

      const [audit] = await db.prisma.auditEvent.findMany();
      expect(audit?.actorKind).toBe('system');
      expect(audit?.systemId).toBe('owner_notification_process');
      // The intent stays capability-attributed. The Owner is the audience, not the actor.
      expect(audit?.capabilityId).toBeNull();
      expect(audit?.ownerId).toBeNull();
      expect(audit?.intendedRecipientEmail).toBeNull();

      const stillTriggering = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(stillTriggering?.actorKind).toBe('capability');
      expect(stillTriggering?.capabilityId).toBe('cap_1');
    });

    it('writes no audit event for a non-terminal retry', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      await settleOwnerNotificationAttempt({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        attemptId: attempt.id,
        claimSequence,
        settlement: { kind: 'retry', failureCode: 'transient' },
        settledAt,
      });

      expect(await db.prisma.auditEvent.count()).toBe(0);
    });

    it('leaves the intent unsettled when its audit event cannot be written', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();
      // Occupy the id the settlement will try to use, so the audit insert fails after the state
      // change has already been applied inside the transaction.
      await db.prisma.auditEvent.create({
        data: {
          id: 'audit_collision',
          organizationId: org,
          actorKind: 'system',
          action: 'unrelated',
          outcome: 'succeeded',
          recordedAt: new Date(settledAt),
        },
      });

      await expect(
        settleOwnerNotificationAttempt({
          db: db.prisma,
          intentId: intent.id,
          organizationId: org,
          attemptId: attempt.id,
          claimSequence,
          settlement: {
            kind: 'sent',
            providerMessageRef: 'fake-msg-1',
            providerAcceptedAt: settledAt,
          },
          settledAt,
          audit: systemAudit({ id: 'audit_collision' }),
        }),
      ).rejects.toThrow();

      // An intent reading `sent` with no audit event is the split this transaction exists to
      // prevent. It is still claimed, still in flight, and still this worker's to settle.
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
      expect(after?.settledAt).toBeNull();
      expect(await listInFlightOwnerNotificationAttempts(db.prisma, intent.id)).toHaveLength(1);
      expect(await db.prisma.auditEvent.count()).toBe(1);
    });
  });

  describe('expired-claim recovery', () => {
    it('returns a lease to claimable work when no provider call had started', async () => {
      const { intent, claimSequence } = await seedClaimed();

      const recovery = await recoverExpiredOwnerNotificationClaim(db.prisma, {
        id: intent.id,
        organizationId: org,
        claimSequence,
      });

      expect(recovery).toEqual({ outcome: 'released' });
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('pending');
      expect(after?.claimedBy).toBeNull();
      expect(after?.settledAt).toBeNull();
      expect(await listClaimableOwnerNotificationIntents(db.prisma, { limit: 25 })).toHaveLength(1);
    });

    it('refuses to release a lease whose provider call had started', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();

      const recovery = await recoverExpiredOwnerNotificationClaim(db.prisma, {
        id: intent.id,
        organizationId: org,
        claimSequence,
      });

      expect(recovery.outcome).toBe('in_flight');
      if (recovery.outcome !== 'in_flight') {
        return;
      }
      expect(recovery.attempt.id).toBe(attempt.id);

      // The release was rolled back: the intent is still claimed, so it cannot be picked up and
      // sent a second time. The caller terminalizes it ambiguous.
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
      expect(await listClaimableOwnerNotificationIntents(db.prisma, { limit: 25 })).toHaveLength(0);
    });

    it('reports a lost race rather than recovering an intent that moved', async () => {
      const { intent, claimSequence } = await seedClaimed();

      const recovery = await recoverExpiredOwnerNotificationClaim(db.prisma, {
        id: intent.id,
        organizationId: org,
        claimSequence: claimSequence - 1,
      });

      expect(recovery).toEqual({ outcome: 'lost' });
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
    });
  });

  describe('terminalizing without a delivery', () => {
    it('suppresses a stale intent and writes no attempt row', async () => {
      const intent = await createOwnerNotificationIntent(db.prisma, intentInput());

      const result = await terminalizeOwnerNotificationWithoutDelivery({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        expectedClaimSequence: intent.claimSequence,
        disposition: { kind: 'suppressed', reason: 'stale' },
        settledAt,
        audit: systemAudit({ action: 'owner_notification.suppressed_stale', outcome: 'denied' }),
      });

      expect(result.settled).toBe(true);
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('suppressed');
      expect(after?.suppressionReason).toBe('stale');
      expect(after?.settledAt).toBe(settledAt);
      expect(after?.attemptCount).toBe(0);
      // No attempt row was invented to make the history look uniform: nothing was contacted.
      expect(await listOwnerNotificationAttempts(db.prisma, intent.id)).toHaveLength(0);
      expect(await db.prisma.auditEvent.count()).toBe(1);
    });

    it('terminalizes a spent retry budget as requiring attention', async () => {
      const intent = await createOwnerNotificationIntent(db.prisma, intentInput());

      const result = await terminalizeOwnerNotificationWithoutDelivery({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        expectedClaimSequence: intent.claimSequence,
        disposition: { kind: 'exhausted', failureCode: 'retry_budget_exhausted' },
        settledAt,
        audit: systemAudit({ action: 'owner_notification.retry_exhausted', outcome: 'failed' }),
      });

      expect(result.settled).toBe(true);
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('requires_owner_attention');
      expect(after?.failureCode).toBe('retry_budget_exhausted');
      expect(after?.suppressionReason).toBeNull();
    });

    it('refuses to terminalize an intent someone else already claimed', async () => {
      const { intent, claimSequence } = await seedClaimed();

      const result = await terminalizeOwnerNotificationWithoutDelivery({
        db: db.prisma,
        intentId: intent.id,
        organizationId: org,
        expectedClaimSequence: claimSequence,
        disposition: { kind: 'suppressed', reason: 'stale' },
        settledAt,
        audit: systemAudit({ action: 'owner_notification.suppressed_stale', outcome: 'denied' }),
      });

      expect(result.settled).toBe(false);
      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
      expect(await db.prisma.auditEvent.count()).toBe(0);
    });
  });

  describe('organization scoping', () => {
    it('refuses every transition asked for by the wrong organization', async () => {
      const { intent, claimSequence, attempt } = await seedInFlight();
      const wrong = 'org_other';

      expect(
        await claimOwnerNotificationIntent(db.prisma, {
          id: intent.id,
          organizationId: wrong,
          expectedClaimSequence: 0,
          claimedBy: 'worker_b',
          claimedAt,
          claimExpiresAt: expiresAt,
        }),
      ).toEqual({ claimed: false, reason: 'lost' });

      expect(
        await recoverExpiredOwnerNotificationClaim(db.prisma, {
          id: intent.id,
          organizationId: wrong,
          claimSequence,
        }),
      ).toEqual({ outcome: 'lost' });

      expect(
        await settleOwnerNotificationAttempt({
          db: db.prisma,
          intentId: intent.id,
          organizationId: wrong,
          attemptId: attempt.id,
          claimSequence,
          settlement: { kind: 'sent', providerMessageRef: 'x', providerAcceptedAt: settledAt },
          settledAt,
          audit: systemAudit({ organizationId: wrong }),
        }),
      ).toEqual({ settled: false, reason: 'lost' });

      const after = await findOwnerNotificationIntentById(db.prisma, org, intent.id);
      expect(after?.state).toBe('claimed');
    });
  });
});
