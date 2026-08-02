/**
 * A8.5a structural guards.
 *
 * These read source rather than run it, because the properties they defend are structural and a
 * behavioural test would go green on the broken code. The A8.4a lesson applies directly: a race
 * test that passes against the unfixed implementation protects nothing, so when a fix is "the
 * decision happens before the transaction" or "this module cannot import that one", the guard has to
 * fail deterministically on any machine with no database.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * The same source with comments removed.
 *
 * These guards are about what a module **depends on**, not about what its documentation is allowed
 * to mention. Scanning raw text made the modules fail for explaining themselves — the repository
 * comment says the module does not know Gmail exists, and the capture flag documents why it copies
 * `ENABLE_REMINDER_DELIVERY`'s exact-string semantics rather than `SUGGESTION_AI_ENABLED`'s. Both
 * statements are true and both should stay. Stripping comments keeps the guard pointed at code.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const TRANSACTIONS = 'packages/db/src/transactions/a4-transactions.ts';
const REPOSITORY = 'packages/db/src/repositories/owner-notification-repository.ts';
const CAPTURE_CONFIG = 'apps/web/lib/notifications/capture-config.ts';
const CAPABILITY_MUTATIONS = 'apps/web/lib/capability/mutations.ts';
const MIGRATION =
  'packages/db/prisma/migrations/20260803120000_a8_5a_owner_notification_intents/migration.sql';

describe('A8.5a capture boundary', () => {
  it('keeps the capture path free of Gmail', () => {
    for (const file of [TRANSACTIONS, REPOSITORY, CAPTURE_CONFIG]) {
      expect(code(file), `${file} must not reach Gmail from a capture path`).not.toMatch(/gmail/i);
    }
  });

  it('keeps the capture path free of reminder delivery policy', () => {
    // Reminder *lifecycle* reconciliation is a long-standing part of this transaction and is not
    // what this guards. Delivery policy — ceilings, ambiguity counting, transports, worker config —
    // must never reach a notification capture path (D135 declines all of it).
    const forbidden = [
      /lib\/reminders\//,
      /process-config/,
      /OVERDUE_SUCCESSFUL_DELIVERY_CEILING/,
      /MAX_OCCURRENCE_ATTEMPTS/,
      /ENABLE_REMINDER_DELIVERY/,
      /repeated_ambiguous/,
    ];
    for (const file of [TRANSACTIONS, REPOSITORY, CAPTURE_CONFIG]) {
      const source = code(file);
      for (const pattern of forbidden) {
        expect(source, `${file} must not import reminder delivery policy (${pattern})`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it('reads no environment variable inside persistence', () => {
    for (const file of [TRANSACTIONS, REPOSITORY]) {
      expect(code(file), `${file} must receive the capture decision, not make it`).not.toMatch(
        /process\.env/,
      );
    }
  });

  it('decides the capture flag before the transaction is entered', () => {
    const source = read(CAPABILITY_MUTATIONS);
    const decision = source.indexOf('isOwnerEventCaptureEnabled()');
    const transactionEntry = source.indexOf('dbRuntime.persistCapabilityAction(');

    expect(decision, 'the capture flag must be read in the mutation service').toBeGreaterThan(-1);
    expect(transactionEntry, 'the capability mutation must go through persistence').toBeGreaterThan(
      -1,
    );
    expect(
      decision,
      'ENABLE_OWNER_EVENT_CAPTURE must be evaluated before persistCapabilityAction opens its ' +
        'transaction: the A8.5 migration is unapplied in Production, so a disabled capture must ' +
        'issue no statement rather than issue one and handle the failure (D135).',
    ).toBeLessThan(transactionEntry);
  });

  it('reaches an A8.5 table only when an intent was requested', () => {
    const source = read(TRANSACTIONS);
    const guard = source.indexOf('if (input.ownerNotification) {');
    const write = source.indexOf('await createOwnerNotificationIntent(tx, {');

    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(guard);
    // Exactly one call site, so there is no second path that could write unguarded.
    expect(code(TRANSACTIONS).match(/createOwnerNotificationIntent\(/g)).toHaveLength(1);
  });

  it('leaves the Owner mutation path unable to request an intent', () => {
    // D133 excludes Owner-initiated actions. Making that a property of the type rather than of a
    // test means it still holds when A8.5d adds the remaining producers.
    expect(read(TRANSACTIONS)).toMatch(
      /persistOwnerTaskMutation\(\s*input:\s*Omit<\s*Parameters<typeof persistCapabilityAction>\[0\],\s*'ownerNotification'\s*>/,
    );
  });

  it('derives the intent identity inside the transaction rather than accepting it', () => {
    const source = read(TRANSACTIONS);
    // Only the identifier and the event type cross the boundary; organization, subject, occurrence,
    // and actor are all taken from state the transaction already holds, so a caller cannot name a
    // different Task, a different organization, or a stale version.
    expect(source).toMatch(/subjectKind: 'task',/);
    expect(source).toMatch(/subjectId: input\.task\.id,/);
    expect(source).toMatch(/occurrenceKey: String\(input\.task\.version\),/);
    expect(source).toMatch(/organizationId: input\.organizationId,/);
    expect(source).toMatch(/actorKind: input\.audit\.actorKind,/);
  });

  it('copies attribution from the audit input so the two cannot disagree', () => {
    const source = read(TRANSACTIONS);
    for (const field of [
      'ownerId',
      'capabilityId',
      'systemId',
      'assignmentId',
      'attributionLabel',
    ]) {
      expect(source, `intent ${field} must be copied from the causing audit event`).toMatch(
        new RegExp(`${field}: input\\.audit\\.${field} \\?\\? null,`),
      );
    }
  });
});

describe('A8.5a migration shape', () => {
  const sql = read(MIGRATION);

  it('is additive: it creates and never drops or rewrites', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(sql).not.toMatch(/\bDELETE\b\s+FROM/i);
  });

  it('touches no existing table', () => {
    const altered = [...sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(
      new Set(['owner_notification_intents', 'owner_notification_attempts']),
    );
  });

  it('declares all ten ratified event types with their dotted names', () => {
    for (const value of [
      'task.completed_by_recipient',
      'task.clarification_requested',
      'task.returned_to_owner',
      'handoff.delivery_failed',
      'gmail.disconnected',
      'capability.expired',
      'reminder.schedule.stopped.ceiling_reached',
      'reminder.schedule.stopped.permanent_failure',
      'reminder.schedule.stopped.repeated_ambiguous',
      'reminder.no_active_assignment',
    ]) {
      expect(sql).toContain(`'${value}'`);
    }
  });

  it('creates no foreign key from an intent to its subject', () => {
    // An event must stay true and deliverable if the Task it describes is purged under retention.
    const references = [...sql.matchAll(/REFERENCES "([a-z_]+)"/g)].map((match) => match[1]);
    expect(references).toEqual(['owner_notification_intents']);
  });

  it('enforces the deduplication identity and the partial pending scan', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "owner_notification_intents_identity_key"[\s\S]*?"organization_id", "event_type", "subject_kind", "subject_id", "occurrence_key"/,
    );
    expect(sql).toMatch(
      /CREATE INDEX "owner_notification_intents_pending_idx"[\s\S]*?WHERE "state" = 'pending'/,
    );
  });

  it('enables row level security on both new tables', () => {
    expect(sql).toContain('ALTER TABLE "owner_notification_intents" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "owner_notification_attempts" ENABLE ROW LEVEL SECURITY;');
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('stores no destination and no message content', () => {
    for (const forbidden of [
      /email/i,
      /recipient_address/i,
      /"subject"/i,
      /body/i,
      /mime/i,
      /token/i,
    ]) {
      const columnBlock = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf('-- The one foreign'));
      expect(columnBlock, `no column may carry ${forbidden}`).not.toMatch(forbidden);
    }
  });
});
