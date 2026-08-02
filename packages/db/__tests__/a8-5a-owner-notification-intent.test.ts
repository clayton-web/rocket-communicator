/**
 * A8.5a Owner notification intent persistence (D133, D135).
 *
 * PGlite establishes shape, mapping, and every invariant the database enforces on a single
 * connection. It cannot establish that two writers racing the same identity produce one winner —
 * one connection makes them sequential — so that lives in `a8-5a-owner-notification.pg.test.ts` and
 * is reported separately.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PersistenceError } from '../src/errors/persistence-errors.js';
import {
  createOwnerNotificationIntent,
  findOwnerNotificationIntentByIdentity,
  listOwnerNotificationIntentsForSubject,
  type CreateOwnerNotificationIntentInput,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const org = 'org_a85a_intent';
const occurredAt = '2026-08-03T09:15:00.000Z';

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
    auditEventId: 'audit_1',
    requestId: 'req_1',
    correlationId: 'corr_1',
    ...overrides,
  };
}

describe('A8.5a owner notification intent', () => {
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
  });

  describe('writing and reading', () => {
    it('round-trips every field through the mapper as ISO instants', async () => {
      const created = await createOwnerNotificationIntent(db.prisma, intentInput());

      expect(created).toMatchObject({
        id: 'onint_1',
        organizationId: org,
        eventType: 'task_completed_by_recipient',
        subjectKind: 'task',
        subjectId: 'task_1',
        occurrenceKey: '4',
        state: 'pending',
        suppressionReason: null,
        failureCode: null,
        attemptCount: 0,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimSequence: 0,
        occurredAt,
        settledAt: null,
        actorKind: 'capability',
        ownerId: null,
        capabilityId: 'cap_1',
        systemId: null,
        assignmentId: 'asg_1',
        attributionLabel: null,
        auditEventId: 'audit_1',
        requestId: 'req_1',
        correlationId: 'corr_1',
      });
      expect(typeof created.createdAt).toBe('string');
      expect(typeof created.updatedAt).toBe('string');

      const found = await findOwnerNotificationIntentByIdentity(db.prisma, {
        organizationId: org,
        eventType: 'task_completed_by_recipient',
        subjectKind: 'task',
        subjectId: 'task_1',
        occurrenceKey: '4',
      });
      expect(found).toEqual(created);
    });

    it('stores the ratified dotted event name in the database', async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput());
      const rows = await db.prisma.$queryRawUnsafe<{ event_type: string }[]>(
        'SELECT "event_type"::text AS event_type FROM "owner_notification_intents"',
      );
      expect(rows[0]?.event_type).toBe('task.completed_by_recipient');
    });

    it('lists a subject history oldest first', async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput({ id: 'onint_a' }));
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({
          id: 'onint_b',
          occurrenceKey: '5',
          eventType: 'task_clarification_requested',
          occurredAt: '2026-08-03T10:15:00.000Z',
        }),
      );

      const history = await listOwnerNotificationIntentsForSubject(
        db.prisma,
        org,
        'task',
        'task_1',
      );
      expect(history.map((row) => row.id)).toEqual(['onint_a', 'onint_b']);
    });
  });

  describe('deduplication identity', () => {
    it('rejects a second intent with the same identity', async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput());

      await expect(
        createOwnerNotificationIntent(db.prisma, intentInput({ id: 'onint_dup' })),
      ).rejects.toMatchObject({ code: 'UNIQUE_VIOLATION' });
      expect(await db.prisma.ownerNotificationIntent.count()).toBe(1);
    });

    it('admits a legitimate repeat at a later Task version', async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput());
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({ id: 'onint_2', occurrenceKey: '5' }),
      );

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(2);
    });

    it('separates identical events in different organizations', async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput());
      await createOwnerNotificationIntent(
        db.prisma,
        intentInput({ id: 'onint_other', organizationId: 'org_other' }),
      );

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(2);
    });

    it('refuses an identity component that identifies nothing', async () => {
      await expect(
        createOwnerNotificationIntent(db.prisma, intentInput({ subjectId: '' })),
      ).rejects.toBeInstanceOf(PersistenceError);
      await expect(
        createOwnerNotificationIntent(db.prisma, intentInput({ occurrenceKey: '' })),
      ).rejects.toBeInstanceOf(PersistenceError);
      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });
  });

  describe('transactional coupling', () => {
    it('leaves no intent behind when the surrounding transaction rolls back', async () => {
      await expect(
        db.prisma.$transaction(async (tx) => {
          await createOwnerNotificationIntent(tx, intentInput());
          throw new Error('the mutation failed after the intent was written');
        }),
      ).rejects.toThrow('the mutation failed');

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(0);
    });

    it('commits the intent with the rest of its transaction', async () => {
      await db.prisma.$transaction(async (tx) => {
        await createOwnerNotificationIntent(tx, intentInput());
      });

      expect(await db.prisma.ownerNotificationIntent.count()).toBe(1);
    });
  });

  /**
   * Each of these is a row the delivery state machine must never be able to write. They are inserted
   * as raw SQL on purpose: a repository that is wrong would refuse them for its own reasons and the
   * constraint would go untested.
   */
  describe('state-coherence CHECK constraints', () => {
    const columns =
      '"id","organization_id","event_type","subject_kind","subject_id","occurrence_key","occurred_at","actor_kind","updated_at"';

    async function insertRaw(extraColumns: string, extraValues: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "owner_notification_intents" (${columns}${extraColumns}) VALUES ` +
          `('onint_raw','${org}','task.completed_by_recipient','task','task_1','9',NOW(),'capability',NOW()${extraValues})`,
      );
    }

    it('refuses a terminal state with no settlement instant', async () => {
      await expect(insertRaw(',"state"', ",'sent'")).rejects.toThrow(
        /owner_notification_intents_settled_at_matches_state/,
      );
    });

    it('refuses a non-terminal state that claims to be settled', async () => {
      await expect(insertRaw(',"state","settled_at"', ",'pending',NOW()")).rejects.toThrow(
        /owner_notification_intents_settled_at_matches_state/,
      );
    });

    it('refuses a suppression with no reason', async () => {
      await expect(insertRaw(',"state","settled_at"', ",'suppressed',NOW()")).rejects.toThrow(
        /owner_notification_intents_suppression_reason_matches_state/,
      );
    });

    it('refuses a suppression reason on a delivered notification', async () => {
      await expect(
        insertRaw(',"state","settled_at","suppression_reason"', ",'sent',NOW(),'stale'"),
      ).rejects.toThrow(/owner_notification_intents_suppression_reason_matches_state/);
    });

    it('refuses a failure code on a state that did not fail', async () => {
      await expect(
        insertRaw(',"state","settled_at","failure_code"', ",'sent',NOW(),'transport_refused'"),
      ).rejects.toThrow(/owner_notification_intents_failure_code_matches_state/);
    });

    it('refuses a half-written claim', async () => {
      await expect(insertRaw(',"claimed_by"', ",'worker_1'")).rejects.toThrow(
        /owner_notification_intents_claim_fields_coherent/,
      );
    });

    it('refuses a lease held by a row that is not claimed', async () => {
      await expect(
        insertRaw(
          ',"state","claimed_by","claimed_at","claim_expires_at","claim_sequence"',
          ",'pending','worker_1',NOW(),NOW(),1",
        ),
      ).rejects.toThrow(/owner_notification_intents_claim_only_when_claimed/);
    });

    it('refuses a claimed row with no lease', async () => {
      await expect(insertRaw(',"state"', ",'claimed'")).rejects.toThrow(
        /owner_notification_intents_claim_only_when_claimed/,
      );
    });

    it('refuses a claimed row that never incremented its fence', async () => {
      await expect(
        insertRaw(
          ',"state","claimed_by","claimed_at","claim_expires_at","claim_sequence"',
          ",'claimed','worker_1',NOW(),NOW(),0",
        ),
      ).rejects.toThrow(/owner_notification_intents_claim_sequence_valid/);
    });

    it('refuses a negative fence and a negative attempt count', async () => {
      await expect(insertRaw(',"claim_sequence"', ',-1')).rejects.toThrow(
        /owner_notification_intents_claim_sequence_valid/,
      );
      await expect(insertRaw(',"attempt_count"', ',-1')).rejects.toThrow(
        /owner_notification_intents_attempt_count_valid/,
      );
    });

    it('refuses an empty identity component at the database level too', async () => {
      await expect(
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "owner_notification_intents" (${columns}) VALUES ` +
            `('onint_raw','${org}','task.completed_by_recipient','task','','9',NOW(),'capability',NOW())`,
        ),
      ).rejects.toThrow(/owner_notification_intents_identity_present/);
    });
  });

  describe('attempt CHECK constraints', () => {
    beforeEach(async () => {
      await createOwnerNotificationIntent(db.prisma, intentInput());
    });

    async function insertAttempt(columns: string, values: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "owner_notification_attempts" ` +
          `("id","organization_id","intent_id","attempt_number","updated_at"${columns}) VALUES ` +
          `('onatt_raw','${org}','onint_1',1,NOW()${values})`,
      );
    }

    it('refuses a sent attempt with no durable proof of acceptance', async () => {
      await expect(
        insertAttempt(',"outcome","provider_call_started_at"', ",'sent',NOW()"),
      ).rejects.toThrow(/owner_notification_attempts_acceptance_matches_outcome/);
    });

    it('refuses acceptance recorded against an outcome that did not succeed', async () => {
      await expect(
        insertAttempt(
          ',"outcome","provider_call_started_at","provider_accepted_at"',
          ",'ambiguous',NOW(),NOW()",
        ),
      ).rejects.toThrow(/owner_notification_attempts_acceptance_matches_outcome/);
    });

    it('refuses a provider outcome with no record that the provider was called', async () => {
      await expect(insertAttempt(',"outcome"', ",'ambiguous'")).rejects.toThrow(
        /owner_notification_attempts_provider_call_recorded/,
      );
    });

    it('refuses a failure code on an attempt that did not fail', async () => {
      await expect(
        insertAttempt(
          ',"outcome","provider_call_started_at","provider_accepted_at","provider_message_ref","failure_code"',
          ",'sent',NOW(),NOW(),'msg_1','transport_refused'",
        ),
      ).rejects.toThrow(/owner_notification_attempts_failure_code_matches_outcome/);
    });

    it('refuses a zero-based attempt number', async () => {
      await expect(
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "owner_notification_attempts" ` +
            `("id","organization_id","intent_id","attempt_number","outcome","provider_call_started_at","updated_at") ` +
            `VALUES ('onatt_raw','${org}','onint_1',0,'in_flight',NOW(),NOW())`,
        ),
      ).rejects.toThrow(/owner_notification_attempts_attempt_number_valid/);
    });

    it('accepts a well-formed sent attempt', async () => {
      await insertAttempt(
        ',"outcome","provider_call_started_at","provider_accepted_at","provider_message_ref"',
        ",'sent',NOW(),NOW(),'msg_1'",
      );
      expect(await db.prisma.ownerNotificationAttempt.count()).toBe(1);
    });

    it('refuses a duplicate attempt number for one intent', async () => {
      await insertAttempt(',"outcome","provider_call_started_at"', ",'in_flight',NOW()");
      await expect(
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "owner_notification_attempts" ` +
            `("id","organization_id","intent_id","attempt_number","outcome","provider_call_started_at","updated_at") ` +
            `VALUES ('onatt_dup','${org}','onint_1',1,'in_flight',NOW(),NOW())`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('row level security', () => {
    it('is enabled with no policies on both tables', async () => {
      const rows = await db.prisma.$queryRawUnsafe<
        { relname: string; relrowsecurity: boolean; policies: bigint }[]
      >(
        `SELECT c.relname, c.relrowsecurity,
                (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema()
           AND c.relname IN ('owner_notification_intents','owner_notification_attempts')
         ORDER BY c.relname`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
        expect(Number(row.policies), `${row.relname} must define no policy`).toBe(0);
      }
    });
  });
});
