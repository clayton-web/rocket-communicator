import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.5e structural guards: two phases that must not become one (D133, D135).
 *
 * The behavioural tests in `a8-5e-notification-worker.test.ts` prove what an invocation *does* with
 * a given pair of flags. These prove the *shape* that keeps those outcomes reachable — an ordering
 * or an import that is wrong is wrong on every run, whereas a behavioural test only catches it when
 * the wrong branch happens to be exercised.
 *
 * ## The A8.5b invariant this slice replaced
 *
 * A8.5b asserted, truthfully, that *delivery disabled means zero database access*. That was a
 * property of an endpoint whose only work was delivery. Keeping it once the endpoint also captures
 * would have meant refusing to observe capability expiry unless mail was already flowing, which
 * inverts the enablement order the whole milestone is built around: capture first, watch, then
 * deliver.
 *
 * The replacement is narrower where it has to be and stronger where it can be:
 *
 *  - **Both flags off** means zero database access and no transport. Strictly stronger than the old
 *    assertion at the point that matters, because it now covers the route rather than only the
 *    delivery service — A8.5b's route constructed a Prisma client before it read anything.
 *  - **Capture on, delivery off** may open the database, and still constructs no transport, claims
 *    no intent, and resolves no credential.
 *  - **Delivery on, capture off** is exactly A8.5b, unchanged.
 *
 * `a8-5b-notification-guards.test.ts` keeps its own assertion that the delivery service reads its
 * flag before `loadDbRuntime`; that one is untouched and still true.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.join(repoRoot, 'apps/web');
const dbSrc = path.join(repoRoot, 'packages/db/src');

/** Strip comments so the guards read executable code, not prose that discusses it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

const WORKER = path.join(webRoot, 'lib/notifications/worker.ts');
const ROUTE = path.join(webRoot, 'app/api/v1/internal/notifications/process/route.ts');
const SERVICE = path.join(webRoot, 'lib/notifications/process-service.ts');
const SWEEP = path.join(webRoot, 'lib/capability/expiry.ts');
const EXPIRY_TX = path.join(dbSrc, 'transactions/a8-5d-capability-expiry.ts');
const CAPABILITY_REPOSITORY = path.join(dbSrc, 'repositories/capability-repository.ts');

describe('A8.5e: both flags off is a refusal, not a fast path', () => {
  it('reads both flags before anything can open a database', () => {
    const code = readCode(WORKER);
    const captureIndex = code.indexOf('isOwnerEventCaptureEnabled(');
    const deliveryIndex = code.indexOf('isOwnerEventDeliveryEnabled(');
    const openIndex = code.indexOf('input.openDb()');

    expect(captureIndex, 'the worker must read the capture flag').toBeGreaterThan(-1);
    expect(deliveryIndex, 'the worker must read the delivery flag').toBeGreaterThan(-1);
    expect(openIndex, 'the worker must open the database somewhere').toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(openIndex);
    expect(deliveryIndex).toBeLessThan(openIndex);

    // The early return sits between them, so the ordering is a refusal and not merely a sequence.
    const between = code.slice(Math.max(captureIndex, deliveryIndex), openIndex);
    expect(
      between,
      'With both flags off the worker must return before `openDb`, so the invocation opens no ' +
        'connection and issues no statement at all (D135).',
    ).toMatch(/if\s*\(!captureEnabled\s*&&\s*!deliveryEnabled\)[\s\S]*?return\s*\{/);
  });

  it('takes the database as a thunk, so not opening it is observable', () => {
    const code = readCode(WORKER);
    expect(code).toMatch(/openDb:\s*\(\)\s*=>\s*Promise<DbClient>/);
    expect(
      code.includes('readonly db:'),
      'A worker handed a live client cannot prove it did not use one. The thunk is what makes ' +
        '"opened no connection" a fact about what ran rather than a claim about where a flag is read.',
    ).toBe(false);
  });

  it('does not open the database in the route before the flags are read', () => {
    const code = readCode(ROUTE);
    expect(
      /await\s+getDb\(\)/.test(code),
      'The route must pass `getDb` rather than await it. A8.5b awaited it before authenticating, ' +
        'which constructed a client on every invocation including the disabled ones.',
    ).toBe(false);
    expect(code).toMatch(/openDb:\s*getDb/);
  });
});

describe('A8.5e: the phases are gated separately', () => {
  it('gates expiry observation on the capture flag alone', () => {
    const code = readCode(WORKER);
    const sweepCall = code.slice(code.indexOf('const expiry ='), code.indexOf('const transport ='));
    expect(sweepCall).toMatch(/captureEnabled\s*\n?\s*\?/);
    expect(
      sweepCall.includes('deliveryEnabled'),
      'Whether an expiry is observed must not depend on whether mail can be sent. A capability ' +
        'going on claiming to be active because delivery is off is an authorization lie.',
    ).toBe(false);
  });

  it('gates transport construction on the delivery flag alone', () => {
    const code = readCode(WORKER);
    const transportLine = code.slice(
      code.indexOf('const transport ='),
      code.indexOf('const delivery ='),
    );
    expect(transportLine).toContain('deliveryEnabled');
    expect(
      transportLine.includes('captureEnabled'),
      'Capture must never be a reason — or a precondition — for resolving a Gmail credential.',
    ).toBe(false);
  });

  it('observes expiry before it delivers', () => {
    const code = readCode(WORKER);
    const sweepIndex = code.indexOf('const expiry =');
    const transportIndex = code.indexOf('const transport =');
    const deliveryIndex = code.indexOf('runInternalNotificationProcess(');

    expect(sweepIndex).toBeGreaterThan(-1);
    expect(
      sweepIndex < transportIndex && transportIndex < deliveryIndex,
      'Capture must run first, so an expiry observed now is deliverable in this invocation rather ' +
        'than waiting for the next one.',
    ).toBe(true);
  });

  it('reads no reminder flag anywhere on the endpoint path', () => {
    for (const modulePath of [WORKER, ROUTE, SERVICE, SWEEP]) {
      expect(
        readCode(modulePath).includes('ENABLE_REMINDER_DELIVERY'),
        `${path.relative(repoRoot, modulePath)} touches ENABLE_REMINDER_DELIVERY. The Recipient ` +
          'reminder engine is gated independently and this endpoint may not read its flag.',
      ).toBe(false);
    }
  });

  it('opts in by exact string on both flags, with no coercion', () => {
    const code = readCode(WORKER);
    for (const loose of ['toLowerCase', 'trim(', 'Boolean(', '!!env', 'includes(']) {
      expect(
        code.includes(loose),
        `The worker normalizes a flag with ${loose}. "TRUE", " true", and "1" are near misses that ` +
          'must stay disabled on each flag independently.',
      ).toBe(false);
    }
  });
});

describe('A8.5e: no phase can reach into the other', () => {
  it('opens no transaction spanning the two phases', () => {
    for (const modulePath of [WORKER, SERVICE]) {
      expect(
        readCode(modulePath).includes('$transaction'),
        `${path.relative(repoRoot, modulePath)} opens a transaction. One spanning both phases would ` +
          'make an invalid Gmail configuration roll back expiry observations that are genuinely ' +
          'true, and would hold capability rows locked across a provider call.',
      ).toBe(false);
    }
  });

  it('keeps the capture path unable to name a provider', () => {
    for (const modulePath of [WORKER, SWEEP, EXPIRY_TX]) {
      const code = readCode(modulePath);
      for (const [pattern, description] of [
        [/\bgmail\b/i, 'anything Gmail'],
        [/googleapis/, 'the Google API SDK'],
        [/google-auth-library/, 'the Google auth library'],
        [/resolveGmailAccess|refreshAccessToken/, 'an access-token resolver'],
        [/buildMime|toRfc822|createMimeMessage/, 'a MIME builder'],
      ] as const) {
        expect(
          pattern.test(code),
          `${path.relative(repoRoot, modulePath)} references ${description}. The capture phase ` +
            'observes a clock arriving; it has no business knowing a mail provider exists.',
        ).toBe(false);
      }
    }
  });

  it('claims and settles no notification from the capture path', () => {
    for (const modulePath of [SWEEP, EXPIRY_TX]) {
      const code = readCode(modulePath);
      for (const forbidden of [
        'claimOwnerNotificationIntent',
        'beginOwnerNotificationAttempt',
        'settleOwnerNotificationAttempt',
        'listClaimableOwnerNotificationIntents',
      ]) {
        expect(
          code.includes(forbidden),
          `${path.relative(repoRoot, modulePath)} calls ${forbidden}. Capture records that an ` +
            'event happened; delivering it is a different phase under a different flag.',
        ).toBe(false);
      }
    }
  });
});

describe('A8.5e: the sweep stays bounded and clock-injected', () => {
  it('always passes a limit to the scan', () => {
    const code = readCode(SWEEP);
    const scan = code.slice(code.indexOf('listExpirableCapabilities('));
    expect(scan.slice(0, scan.indexOf('}')), 'the scan must be bounded').toMatch(/limit/);
    expect(code).toMatch(/MAX_CAPABILITY_EXPIRIES_PER_SWEEP\s*=\s*\d+/);
  });

  it('refuses an unbounded or absurd limit at the persistence boundary', () => {
    const code = readCode(CAPABILITY_REPOSITORY);
    const scan = code.slice(code.indexOf('export async function listExpirableCapabilities'));
    expect(
      scan.slice(0, scan.indexOf('const rows')),
      'The repository must validate the batch size rather than trusting a caller, so a bug in the ' +
        'worker cannot turn a bounded scan into a full-table one.',
    ).toMatch(/Number\.isInteger|throw/);
  });

  it('orders the scan deterministically, oldest expiry first', () => {
    const code = readCode(CAPABILITY_REPOSITORY);
    const scan = code.slice(code.indexOf('export async function listExpirableCapabilities'));
    expect(
      scan.slice(0, scan.indexOf('return rows')),
      'Without a stable order a bounded scan can revisit the same rows and starve the rest.',
    ).toMatch(/orderBy:\s*\[\{\s*expiresAt:\s*'asc'\s*\},\s*\{\s*id:\s*'asc'\s*\}\]/);
  });

  it('reads no clock inside the database package', () => {
    for (const modulePath of [EXPIRY_TX, CAPABILITY_REPOSITORY]) {
      const code = readCode(modulePath);
      for (const pattern of [/\bDate\.now\s*\(/, /new Date\s*\(\s*\)/]) {
        expect(
          pattern.test(code),
          `${path.relative(repoRoot, modulePath)} reads the clock. The observation instant must ` +
            'arrive as an argument so one invocation decides "now" once (D103).',
        ).toBe(false);
      }
    }
  });

  it('uses one observation instant for the whole sweep', () => {
    const code = readCode(SWEEP);
    const sweep = code.slice(code.indexOf('export async function runCapabilityExpirySweep'));
    // `input.now` for both the scan bound and every transition; the only `Date.now()` is the
    // deadline comparison, which is a stopping decision rather than an event instant.
    expect(sweep).toMatch(/expiresAtOrBefore:\s*input\.now/);
    expect(sweep).toMatch(/observedAt:\s*input\.now/);
  });
});

describe('A8.5e: the response says only what it may', () => {
  it('carries counts and flags only', () => {
    const code = readCode(WORKER);
    const aggregate = code.slice(
      code.indexOf('interface OwnerNotificationWorkerAggregate'),
      code.indexOf('const ZERO_SWEEP'),
    );
    const fields = [...aggregate.matchAll(/readonly (\w+):\s*(\w+)/g)];
    expect(fields.length).toBeGreaterThanOrEqual(6);
    for (const [, name, type] of fields) {
      expect(
        ['number', 'boolean', 'string'].includes(type!),
        `${name} is a ${type}. The worker response carries counts and flags only.`,
      ).toBe(true);
    }
  });

  it('names no capability, address, token, or instant in the capture fields', () => {
    const code = readCode(WORKER);
    for (const forbidden of [
      'capabilityId',
      'tokenHash',
      'expiresAt',
      'intendedRecipientEmail',
      'subjectId',
      'organizationId',
    ]) {
      expect(
        code.includes(forbidden),
        `The worker references ${forbidden}. An aggregate that names which capability expired, ` +
          'or when, tells a log reader more about a Recipient than a count ever could.',
      ).toBe(false);
    }
  });

  it('declares every capture field in the contract', () => {
    const schema = readFileSync(
      path.join(repoRoot, 'packages/contracts/openapi/components/schemas/owner-notification.yaml'),
      'utf8',
    );
    for (const field of [
      'captureEnabled',
      'expiryScanned',
      'expiryObserved',
      'expiryLostRaces',
      'expiryBatchFilled',
      'expiryDeadlineStopped',
    ]) {
      expect(schema, `${field} must be contracted`).toContain(`${field}:`);
      expect(schema, `${field} must be required`).toContain(`- ${field}`);
    }
  });
});

describe('A8.5e: still nothing is scheduled or enabled', () => {
  it('adds no cron', () => {
    const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
      crons?: unknown[];
    };
    expect(
      vercel.crons ?? [],
      'A8.5e creates no schedule. The endpoint is invoked by nothing.',
    ).toEqual([]);
  });

  it('enables no flag in a repository environment file', () => {
    const example = readFileSync(path.join(webRoot, '.env.example'), 'utf8');
    expect(example).not.toMatch(/^\s*ENABLE_OWNER_EVENT_CAPTURE\s*=\s*true/m);
    expect(example).not.toMatch(/^\s*ENABLE_OWNER_EVENT_DELIVERY\s*=\s*true/m);
    expect(example).not.toMatch(/^\s*ENABLE_REMINDER_DELIVERY\s*=\s*true/m);
  });

  it('leaves the reminder worker untouched', () => {
    const reminderRoute = readCode(
      path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'),
    );
    expect(reminderRoute).not.toContain('notification');
    expect(reminderRoute).not.toContain('Notification');
    expect(reminderRoute).not.toContain('CapabilityExpiry');
  });
});
