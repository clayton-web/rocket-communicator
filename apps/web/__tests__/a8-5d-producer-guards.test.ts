import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.5d taxonomy coverage and structural guards (D133–D136).
 *
 * A8.5a through A8.5c could be guarded by asking what one path does. A8.5d cannot: the question is
 * now whether *every* ratified event has a producer, whether each producer is at the transaction
 * that makes its event true, and whether adding nine of them changed anything about reminders,
 * handoffs, or Gmail beyond inserting a row. That is a question about the shape of the whole
 * feature, and the only thing that can answer it on every run, without a database or a provider, is
 * a read of the source.
 *
 * The coverage test below is the one that has to keep working after A8.5d ships. It is derived from
 * the Prisma enum rather than from a list written here, so an eleventh event added to the taxonomy
 * fails until somebody either produces it or writes down why it has no producer.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.join(repoRoot, 'apps/web');
const dbSrc = path.join(repoRoot, 'packages/db/src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

const SCHEMA = path.join(repoRoot, 'packages/db/prisma/schema.prisma');
const RENDERER = path.join(webRoot, 'lib/gmail/outbound/owner-notification-email.ts');
const CAPTURE_CONFIG = path.join(webRoot, 'lib/notifications/capture-config.ts');
const CAPABILITY_MUTATIONS = path.join(webRoot, 'lib/capability/mutations.ts');
const CAPABILITY_EXPIRY = path.join(webRoot, 'lib/capability/expiry.ts');
const CAPABILITY_LIFECYCLE = path.join(webRoot, 'lib/capability/lifecycle.ts');
const HANDOFF_STORE = path.join(webRoot, 'lib/handoff/runtime-store.ts');
const SYNC_ENGINE = path.join(webRoot, 'lib/gmail/sync-engine.ts');
const REMINDER_SERVICE = path.join(webRoot, 'lib/reminders/process-service.ts');
const NOTIFICATION_ROUTE = path.join(webRoot, 'app/api/v1/internal/notifications/process/route.ts');

const A4_TX = path.join(dbSrc, 'transactions/a4-transactions.ts');
const A7_TX = path.join(dbSrc, 'transactions/a7-handoff-transactions.ts');
const GMAIL_TX = path.join(dbSrc, 'transactions/gmail-transactions.ts');
const REMINDER_TX = path.join(dbSrc, 'transactions/a8-4a-occurrence-transactions.ts');
const EXPIRY_TX = path.join(dbSrc, 'transactions/a8-5d-capability-expiry.ts');

/** Every producer site, and the transaction each one's intent is written from. */
const PRODUCERS: ReadonlyArray<{
  readonly event: string;
  readonly transaction: string;
  readonly caller: string;
}> = [
  {
    event: 'task_completed_by_recipient',
    transaction: A4_TX,
    caller: CAPABILITY_MUTATIONS,
  },
  {
    event: 'task_clarification_requested',
    transaction: A4_TX,
    caller: CAPABILITY_MUTATIONS,
  },
  { event: 'task_returned_to_owner', transaction: A4_TX, caller: CAPABILITY_MUTATIONS },
  { event: 'handoff_delivery_failed', transaction: A7_TX, caller: HANDOFF_STORE },
  { event: 'gmail_disconnected', transaction: GMAIL_TX, caller: SYNC_ENGINE },
  { event: 'capability_expired', transaction: EXPIRY_TX, caller: CAPABILITY_EXPIRY },
  {
    event: 'reminder_schedule_stopped_ceiling_reached',
    transaction: REMINDER_TX,
    caller: REMINDER_SERVICE,
  },
  {
    event: 'reminder_schedule_stopped_permanent_failure',
    transaction: REMINDER_TX,
    caller: REMINDER_SERVICE,
  },
  {
    event: 'reminder_schedule_stopped_repeated_ambiguous',
    transaction: REMINDER_TX,
    caller: REMINDER_SERVICE,
  },
  { event: 'reminder_no_active_assignment', transaction: REMINDER_TX, caller: REMINDER_SERVICE },
];

/** The ratified taxonomy, read from the enum the database actually enforces. */
function ratifiedEvents(): string[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  const block = schema.slice(schema.indexOf('enum OwnerNotificationEventType {'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  return body
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name.length > 0);
}

describe('A8.5d: every ratified event has a producer', () => {
  it('produces all ten, with no approved exception left', () => {
    const ratified = ratifiedEvents();
    expect(ratified).toHaveLength(10);

    const produced = PRODUCERS.map((producer) => producer.event);
    expect([...produced].sort()).toEqual([...ratified].sort());
  });

  it('writes each event from the transaction that establishes it', () => {
    for (const producer of PRODUCERS) {
      const transaction = readCode(producer.transaction);
      const caller = readCode(producer.caller);

      // The event literal sits either in the transaction or at the call site that hands it in. The
      // three Task-lifecycle events share `persistCapabilityAction`, which is why the literal is the
      // caller's: the transaction is the same one either way, and the closed type below is what
      // stops the caller naming something the taxonomy has never heard of.
      expect(
        transaction.includes(`'${producer.event}'`) || caller.includes(`'${producer.event}'`),
        `${producer.event} names no producer in either ` +
          `${path.relative(repoRoot, producer.transaction)} or ` +
          `${path.relative(repoRoot, producer.caller)}.`,
      ).toBe(true);

      // Whichever names it, the intent is written from inside the transaction, against `tx`.
      expect(transaction).toMatch(/createOwnerNotificationIntent\(\s*tx\s*,/);
    }
  });

  it('types the one caller-supplied event as the closed enum', () => {
    // `persistCapabilityAction` is the only producer whose event arrives as an argument. Typing it
    // as the enum is what keeps "a caller cannot invent an event" a property of the compiler.
    expect(readCode(A4_TX)).toMatch(/eventType:\s*OwnerNotificationEventTypeValue/);
  });

  it('renders all ten exhaustively', () => {
    const code = readCode(RENDERER);
    for (const event of ratifiedEvents()) {
      expect(code, `${event} has no rendered copy.`).toContain(event);
    }
  });

  it('emits no event value outside the enum', () => {
    const ratified = new Set(ratifiedEvents());
    for (const modulePath of [A4_TX, A7_TX, GMAIL_TX, REMINDER_TX, EXPIRY_TX]) {
      const code = readCode(modulePath);
      // Every string handed to `eventType:` must be a ratified member. A computed one would not
      // match this pattern and is caught by the closed types instead.
      for (const [, literal] of code.matchAll(/eventType:\s*'([a-z0-9_]+)'/g)) {
        expect(ratified.has(literal), `${literal} is not in the ratified taxonomy.`).toBe(true);
      }
    }
  });

  it('offers no open-ended emit API that would accept an arbitrary string', () => {
    for (const modulePath of [A4_TX, A7_TX, GMAIL_TX, REMINDER_TX, EXPIRY_TX, CAPTURE_CONFIG]) {
      const code = readCode(modulePath);
      expect(code).not.toMatch(/eventType:\s*string/);
      expect(code).not.toMatch(/function\s+emitNotification/);
    }
  });
});

describe('A8.5d: capture is gated, and gated on the right flag', () => {
  it('decides capture before opening a request-driven transaction', () => {
    const code = readCode(CAPABILITY_MUTATIONS);
    // The decision is a synchronous flag read that produces the identifier, so an absent decision
    // is an absent argument rather than a query against a table that may not exist.
    expect(code).toMatch(/isOwnerEventCaptureEnabled\(\)/);
    expect(code).toMatch(/isOwnerEventCaptureEnabled\(\)\s*\?/);
  });

  it('never decides capture from the delivery flag', () => {
    for (const modulePath of [
      CAPABILITY_MUTATIONS,
      CAPABILITY_EXPIRY,
      CAPABILITY_LIFECYCLE,
      HANDOFF_STORE,
      SYNC_ENGINE,
      REMINDER_SERVICE,
    ]) {
      const code = readCode(modulePath);
      expect(
        code.includes('isOwnerEventDeliveryEnabled') ||
          code.includes('ENABLE_OWNER_EVENT_DELIVERY'),
        `${path.relative(repoRoot, modulePath)} reads the delivery flag to decide capture. ` +
          'The two are independent controls (D135).',
      ).toBe(false);
    }
  });

  it('leaves the reminder delivery flag alone', () => {
    for (const modulePath of [
      CAPABILITY_EXPIRY,
      HANDOFF_STORE,
      SYNC_ENGINE,
      CAPABILITY_MUTATIONS,
      NOTIFICATION_ROUTE,
    ]) {
      expect(readCode(modulePath)).not.toContain('ENABLE_REMINDER_DELIVERY');
    }
  });

  it('makes every producer transaction treat capture as optional', () => {
    for (const modulePath of [A4_TX, A7_TX, GMAIL_TX, REMINDER_TX, EXPIRY_TX]) {
      const code = readCode(modulePath);
      expect(
        code,
        `${path.relative(repoRoot, modulePath)} must accept an absent capture, so a Production ` +
          'database without the A8.5 tables is never queried.',
      ).toMatch(/ownerNotification\?:/);
      expect(code).toMatch(/if\s*\(input\.ownerNotification/);
    }
  });
});

describe('A8.5d: producers derive events from state, never from the audit log', () => {
  it('reads no audit table as a work queue', () => {
    for (const modulePath of [A4_TX, A7_TX, GMAIL_TX, REMINDER_TX, EXPIRY_TX]) {
      const code = readCode(modulePath);
      expect(code).not.toMatch(/auditEvent\.findMany/);
      expect(code).not.toMatch(/auditEvent\.findFirst/);
    }
  });

  it('never lets a producer choose where a notification goes', () => {
    for (const modulePath of [
      A4_TX,
      A7_TX,
      GMAIL_TX,
      REMINDER_TX,
      EXPIRY_TX,
      CAPABILITY_EXPIRY,
      HANDOFF_STORE,
      REMINDER_SERVICE,
    ]) {
      const code = readCode(modulePath);
      // The destination is resolved by the transport from the connected account, at send time
      // (A8.5c). A producer that named one would freeze a stale address into a durable row.
      expect(code).not.toMatch(/destinationEmail|toAddress|recipientEmail:\s*['"`]/);
    }
  });

  it('persists no note body, clarification text, or provider detail on an intent', () => {
    for (const modulePath of [A4_TX, A7_TX, GMAIL_TX, REMINDER_TX, EXPIRY_TX]) {
      const code = readCode(modulePath);
      const calls = [
        ...code.matchAll(/createOwnerNotificationIntent\(tx,\s*\{([\s\S]*?)\n\s*\}\)/g),
      ];
      expect(calls.length).toBeGreaterThan(0);
      for (const [, body] of calls) {
        for (const forbidden of [
          'note.body',
          'note.text',
          'failureCode',
          'errorCode',
          'excerpt',
          'token',
          'emailAddress',
          'intendedRecipientEmail',
        ]) {
          expect(
            body.includes(forbidden),
            `${path.relative(repoRoot, modulePath)} writes ${forbidden} into an intent.`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('A8.5d: capability expiry stays inside its boundary', () => {
  it('reads no clock in the database package', () => {
    const code = readCode(EXPIRY_TX);
    expect(code).not.toMatch(/new Date\(\)/);
    expect(code).not.toMatch(/Date\.now\(\)/);
    // The observation instant arrives as an argument, as everywhere in this package (D103).
    expect(code).toMatch(/readonly at: string/);
  });

  it('does not depend on a Recipient presenting a token', () => {
    const code = readCode(EXPIRY_TX);
    expect(code).not.toContain('tokenHash');
    expect(code).not.toContain('capabilityToken');
  });

  it('sends nothing and claims no notification', () => {
    for (const modulePath of [EXPIRY_TX, CAPABILITY_EXPIRY]) {
      const code = readCode(modulePath);
      expect(code).not.toContain('claimOwnerNotificationIntent');
      expect(code).not.toMatch(/gmail|Gmail/);
    }
  });

  it('reaches the same transaction from the sweep and from lazy validation', () => {
    // One expiry is one fact, so both observers commit it the same way or a race writes it twice.
    expect(readCode(CAPABILITY_LIFECYCLE)).toContain('observeCapabilityExpiryForOrganization');
    expect(readCode(CAPABILITY_EXPIRY)).toContain('observeCapabilityExpiry');
  });

  it('bounds the sweep rather than scanning everything', () => {
    const code = readCode(CAPABILITY_EXPIRY);
    expect(code).toMatch(/limit/);
  });
});

describe('A8.5d: reminder capture changed no reminder decision', () => {
  it('imports no transport into the reminder producer', () => {
    const code = readCode(REMINDER_TX);
    expect(code).not.toMatch(/from '.*gmail/i);
    expect(code).not.toContain('Transport');
  });

  it('keeps the notification out of every reminder decision', () => {
    const code = readCode(REMINDER_TX);
    // `ownerNotification` may be read to decide whether to write a row, and nowhere else. A
    // reminder branch that consulted it would make scheduling depend on notification configuration.
    const reads = [...code.matchAll(/input\.ownerNotification/g)];
    expect(reads.length).toBeGreaterThan(0);
    expect(code).not.toMatch(
      /ownerNotification[\s\S]{0,80}(stopReason|ceilingReached|generation:)/,
    );
  });
});

describe('A8.5d: nothing was scheduled, and nothing was deployed', () => {
  it('adds no cron', () => {
    const vercel = path.join(repoRoot, 'vercel.json');
    let raw: string;
    try {
      raw = readFileSync(vercel, 'utf8');
    } catch {
      // No `vercel.json` at all is the strongest possible form of "no cron exists".
      return;
    }
    expect(JSON.parse(raw).crons).toBeUndefined();
  });

  it('leaves the expiry sweep unwired to any worker', () => {
    // A8.5d implements the sweep and proves it. Invoking it is A8.5e's decision, and until then no
    // documentation may claim it is scheduled.
    const code = readCode(NOTIFICATION_ROUTE);
    expect(code).not.toContain('runCapabilityExpirySweep');
  });
});
