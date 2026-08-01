import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.4a structural guards.
 *
 * Two of the A8 lifecycle re-audit's findings are architectural regressions rather than data bugs,
 * and both were previously "covered" only by concurrency tests that reproduce them probabilistically.
 * The re-audit measured that directly (finding H-B): with the pre-fix unlocked no-op branch restored,
 * 240 rounds of the real-PostgreSQL race suite failed to fail. The race was real, but the window was
 * a few microseconds wide and the tests could not reliably land in it.
 *
 * A guard that reads the source fails on the design, not on the timing. These tests reject the
 * pre-fix shape deterministically, on every run, on any machine, with no database.
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

describe('H-B: the immaterial-repeat decision cannot leave the locked transaction', () => {
  const serviceCode = readCode(path.join(webRoot, 'lib/reminders/service.ts'));

  /**
   * The pre-fix defect exactly. The service read the schedule and the canonical due date on two
   * unlocked connections, compared them itself, and returned `changed: false` with a representation
   * assembled from two different moments — an active schedule behind a null due date, and an ETag
   * that was stale before it was serialized.
   */
  it('never calls isDueDateChangeMaterial in the Owner reminder service', () => {
    expect(
      serviceCode.includes('isDueDateChangeMaterial'),
      'The Owner reminder service must not decide materiality. That decision belongs to ' +
        'persistOwnerReminderGenerationChange, which makes it under the Task row lock from one ' +
        'transactional snapshot (A8 lifecycle audit H-1). A service-level comparison necessarily ' +
        'reads unlocked, which is how the pre-fix code returned an incoherent no-op.',
    ).toBe(false);
  });

  it('never imports a materiality predicate from the domain', () => {
    const domainImports = serviceCode.match(/import\s*\{[^}]*\}\s*from\s*['"]@aicaa\/domain['"]/s);
    expect(domainImports?.[0] ?? '').not.toMatch(/Material/i);
  });

  /**
   * The structural half of the same rule: every successful PUT outcome must come out of the
   * transaction, so there is no unlocked branch left that *could* short-circuit to success.
   */
  it('never returns an inline no-op — only the transaction may report one', () => {
    const setBody = extractFunction(serviceCode, 'setOwnerTaskReminder');
    expect(
      setBody.match(/changed:\s*false/) ?? null,
      'A literal `changed: false` in the service is the pre-fix defect itself: the service can only ' +
        'reach that conclusion by comparing two unlocked reads. A no-op must arrive as ' +
        '`result.changed` from the transaction that proved it under the Task row lock.',
    ).toBe(null);
    expect(setBody).toMatch(/changed:\s*result\.changed/);
    // The one inline `changed: true` is establishment, which is a change by definition and still
    // comes back from a transaction — there is no prior generation it could be a no-op against.
    expect(setBody).toMatch(/persistOwnerReminderEstablishment/);
    expect(setBody).toMatch(/persistOwnerReminderGenerationChange/);
  });

  /**
   * The transaction API shape that makes a service-level no-op impossible: `changed` is reported by
   * persistence, so the service has nothing to decide.
   */
  it('has the transaction report `changed`, so the service cannot invent it', () => {
    const transactions = readCode(
      path.join(dbSrc, 'transactions/a8b-owner-reminder-transactions.ts'),
    );
    // Compare call sites, not the import block, which necessarily names the predicate first.
    const body = transactions.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
    const lockIndex = body.indexOf('lockTaskScopeForReminderMutation(');
    const materialityIndex = body.indexOf('isDueDateChangeMaterial(');
    expect(
      lockIndex,
      'Expected a Task row lock in the Owner reminder transaction.',
    ).toBeGreaterThan(-1);
    expect(
      materialityIndex,
      'Expected the materiality decision to live in the transaction, not the service.',
    ).toBeGreaterThan(-1);
    expect(
      lockIndex,
      'Materiality must be evaluated after the Task row lock is taken, not before it.',
    ).toBeLessThan(materialityIndex);
  });

  it('reads the real service with real content', () => {
    expect(serviceCode.length).toBeGreaterThan(2000);
    expect(serviceCode).toContain('setOwnerTaskReminder');
  });
});

describe('H-A: the Owner GET projects one database snapshot', () => {
  const serviceCode = readCode(path.join(webRoot, 'lib/reminders/service.ts'));
  const getBody = extractFunction(serviceCode, 'getOwnerTaskReminder');

  it('does not read the schedule and the due date as two independent statements', () => {
    expect(
      getBody,
      'The GET path must not fan two unlocked reads out in parallel. The re-audit raced exactly ' +
        'that shape against a concurrent DELETE and got an active schedule behind a null due date.',
    ).not.toMatch(/Promise\.all/);
  });

  it('reads through the coherent single-snapshot projection', () => {
    expect(getBody).toMatch(/readCoherentReminderProjection/);
  });

  it('takes its snapshot at an isolation level that holds across both reads', () => {
    const projection = readCode(path.join(dbSrc, 'transactions/a8-reminder-transactions.ts'));
    expect(projection).toMatch(/isolationLevel:\s*'RepeatableRead'/);
  });
});

describe('F8: the raw success writer is not reachable through any barrel', () => {
  const RAW_WRITER = 'recordTerminalOccurrenceOutcomeUnsafe';

  for (const barrel of ['index.ts', 'runtime.ts']) {
    it(`packages/db/src/${barrel} does not export ${RAW_WRITER}`, () => {
      const code = readCode(path.join(dbSrc, barrel));
      expect(
        code,
        `${RAW_WRITER} can write a success without counting it, without evaluating the D106 ` +
          'ceiling, and without settling an advance disposition. finalizeReminderOccurrence is the ' +
          'only public success path (A8.3a audit F8).',
      ).not.toContain(RAW_WRITER);
    });
  }

  it('the deleted F1-unsafe transactions have not returned', () => {
    for (const barrel of ['index.ts', 'runtime.ts']) {
      const code = readCode(path.join(dbSrc, barrel));
      expect(code).not.toContain('persistSuccessfulOverdueDelivery');
      expect(code).not.toContain('persistNonDeliveryOutcome');
    }
  });

  it('the safe success path is exported and is a transaction', () => {
    const index = readCode(path.join(dbSrc, 'index.ts'));
    expect(index).toContain('finalizeReminderOccurrence');
    const safe = readCode(path.join(dbSrc, 'transactions/a8-4a-occurrence-transactions.ts'));
    expect(safe).toMatch(/\$transaction/);
    expect(safe).toMatch(/hasReachedOverdueDeliveryCeiling/);
    // The packaging convention: relative specifier, not a bare `@aicaa/domain` runtime import.
    expect(safe).toContain("from '../../../domain/dist/index.js'");
  });
});

describe('A-A: only a terminal outcome settles an advance disposition', () => {
  it('the lifecycle resume path asks for a terminal outcome, not any attempt row', () => {
    const effects = readCode(path.join(dbSrc, 'transactions/a8-lifecycle-reminder-effects.ts'));
    expect(effects).toContain('hasTerminalAdvanceOccurrence');
    expect(
      effects,
      'hasProcessedAdvanceOccurrence counted a bare `claimed` lease as processed, which would let ' +
        'a dead claim freeze an advance occurrence forever (re-audit A-A).',
    ).not.toContain('hasProcessedAdvanceOccurrence');
  });

  it('is gone from the repository and from the barrel', () => {
    const repository = readCode(
      path.join(dbSrc, 'repositories/reminder-delivery-attempt-repository.ts'),
    );
    expect(repository).not.toContain('hasProcessedAdvanceOccurrence');
    expect(readCode(path.join(dbSrc, 'index.ts'))).not.toContain('hasProcessedAdvanceOccurrence');
  });
});

describe('the processing slice cannot reach a real provider', () => {
  const PROCESSING_SOURCES = [
    'lib/reminders/process-service.ts',
    'lib/reminders/transport.ts',
    'lib/reminders/process-config.ts',
    'app/api/v1/internal/reminders/process/route.ts',
  ];

  /**
   * `authorizeCronRequest` sits under `lib/gmail/` because the Gmail poll was the first internal
   * job to need bearer auth. It parses a header and compares a secret; it holds no transport, no
   * credential, and no client. Every other Gmail specifier stays forbidden.
   */
  const CRON_AUTH = "from '@/lib/gmail/cron-auth'";

  for (const relativePath of PROCESSING_SOURCES) {
    it(`${relativePath} imports no Gmail or provider transport`, () => {
      const code = readCode(path.join(webRoot, relativePath)).split(CRON_AUTH).join('');
      for (const forbidden of [
        /from\s+['"][^'"]*gmail[^'"]*['"]/i,
        /googleapis/i,
        /@aicaa\/ai/,
        /nodemailer/i,
      ]) {
        expect(
          code.match(forbidden)?.[0] ?? null,
          `${relativePath} must not reach a provider`,
        ).toBe(null);
      }
    });
  }

  it('the cron-auth helper is the one shared exception, and it carries no client', () => {
    const route = readCode(path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'));
    expect(route).toContain('authorizeCronRequest');
    const cronAuth = readCode(path.join(webRoot, 'lib/gmail/cron-auth.ts'));
    expect(cronAuth).not.toMatch(/googleapis|google-auth|OAuth2/i);
  });

  it('the fake transport is the only transport the service can be handed', () => {
    const transport = readCode(path.join(webRoot, 'lib/reminders/transport.ts'));
    expect(transport).toContain('FakeReminderTransport');
    // A8.4b introduces the real one. Until then a production transport must not exist to inject.
    expect(transport).not.toMatch(/class\s+Gmail|RealReminderTransport/);
  });
});

/**
 * Extract one function body by brace matching.
 *
 * A regex cannot do this: the bodies here contain nested braces, template literals, and object
 * returns, and a lazy match would stop at the first `}` and silently pass a guard that had read
 * three lines of a forty-line function.
 */
function extractFunction(source: string, name: string): string {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const start = source.search(signature);
  if (start === -1) {
    throw new Error(`Function ${name} not found — the guard is reading the wrong file.`);
  }
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces reading ${name}.`);
}
