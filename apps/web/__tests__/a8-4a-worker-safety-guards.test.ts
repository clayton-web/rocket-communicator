import { readFileSync, readdirSync } from 'node:fs';
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

describe('F8: no writer that terminalizes without settling is reachable through a barrel', () => {
  /**
   * Every writer that can leave an occurrence terminal while the schedule knows nothing about it.
   *
   * `recordTerminalOccurrenceOutcomeUnsafe` is the original F8 finding. The other two arrived with
   * the two-phase split: phase A on its own, and the exhaustion writer that terminalizes without a
   * claim. All three are correct *as a phase*, and all three are wrong as a public API, because a
   * caller that ran one and stopped would leave settlement debt only the sweep would ever notice.
   */
  const PHASE_ONLY_WRITERS = [
    'recordTerminalOccurrenceOutcomeUnsafe',
    'terminalizeExhaustedOccurrenceUnsafe',
    'terminalizeReminderOccurrence',
  ];

  for (const barrel of ['index.ts', 'runtime.ts']) {
    for (const writer of PHASE_ONLY_WRITERS) {
      it(`packages/db/src/${barrel} does not export ${writer}`, () => {
        const code = readCode(path.join(dbSrc, barrel));
        expect(
          code,
          `${writer} records a terminal outcome without applying it to the schedule. ` +
            'finalizeReminderOccurrence and terminalizeExhaustedRetryOccurrence are the public ' +
            'paths, and both run settlement (A8.3a audit F8, A8.4a audit H1).',
        ).not.toContain(writer);
      });
    }
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
  /**
   * Every reminder module, discovered rather than listed (A8.4a audit).
   *
   * The guard used to name four files. A hand-maintained list is exactly the wrong shape for a
   * structural guard: the way the rule gets broken is by *adding* a module, and a list of existing
   * files is silent about the file that was just added. Scanning the directory means a new module
   * is covered on the day it appears, by nobody remembering anything.
   */
  const REMINDER_DIR = 'lib/reminders';
  const PROCESSING_SOURCES = readdirSync(path.join(webRoot, REMINDER_DIR))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))
    .map((entry) => `${REMINDER_DIR}/${entry}`);

  /**
   * `authorizeCronRequest` sits under `lib/gmail/` because the Gmail poll was the first internal
   * job to need bearer auth. It parses a header and compares a secret; it holds no transport, no
   * credential, and no client. Every other Gmail specifier stays forbidden.
   */
  const CRON_AUTH = "from '@/lib/gmail/cron-auth'";

  it('discovers the whole reminder directory rather than a stale list', () => {
    // A guard that silently reads nothing passes every assertion below it.
    expect(PROCESSING_SOURCES.length).toBeGreaterThanOrEqual(5);
    for (const expected of [
      `${REMINDER_DIR}/process-service.ts`,
      `${REMINDER_DIR}/transport.ts`,
      `${REMINDER_DIR}/process-config.ts`,
    ]) {
      expect(PROCESSING_SOURCES).toContain(expected);
    }
  });

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

  /**
   * The route is the composition root, and A8.4b.1 gives it exactly one more Gmail import.
   *
   * The directory guard above deliberately no longer covers the route. It cannot: a real transport
   * has to be constructed *somewhere*, and the whole design of this slice is that the somewhere is a
   * single composition point rather than anywhere inside the processing slice. So the rule for the
   * route is not "no Gmail" but "one Gmail seam and nothing else", enumerated here — which is a
   * stronger statement than the old blanket ban was, because the old ban was satisfiable only by an
   * endpoint that could never deliver anything.
   */
  it('the route imports exactly two Gmail seams: cron auth and the reminder transport provider', () => {
    const route = readCode(path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'));
    const gmailImports = [
      ...route.matchAll(/from\s+['"](?<specifier>[^'"]*gmail[^'"]*)['"]/gi),
    ].map((match) => match.groups?.specifier);
    expect([...gmailImports].sort()).toEqual([
      '@/lib/gmail/cron-auth',
      '@/lib/gmail/reminder-transport-provider',
    ]);
    for (const forbidden of [/googleapis/i, /@aicaa\/ai/, /nodemailer/i]) {
      expect(route.match(forbidden)?.[0] ?? null).toBe(null);
    }
  });

  it('the fake transport is the only transport inside the processing slice', () => {
    const transport = readCode(path.join(webRoot, 'lib/reminders/transport.ts'));
    expect(transport).toContain('FakeReminderTransport');
    // A8.4b.1's real transport is a Gmail module. It must never appear in this directory, because
    // `lib/reminders` is what the guards above keep provider-free.
    expect(transport).not.toMatch(/class\s+Gmail|RealReminderTransport|sendRawMessage/);
  });
});

/**
 * H3: production orchestration cannot manufacture a transport, accepting or otherwise.
 *
 * The audit's objection was not that a fake was reachable — the flag is off and the endpoint is
 * undeployed — but that the *default* was acceptance. One environment variable stood between a dark
 * deployment and a system recording fourteen deliveries per Task, exhausting the D106 ceiling, and
 * sending nothing at all. There is no downstream check that would catch that, so the guard is
 * structural: the service must have no way to construct a transport, and must refuse to work
 * without one.
 */
describe('H3: the processing service fails closed rather than faking a send', () => {
  const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));

  it('never constructs a transport of any kind', () => {
    expect(
      service.match(/new\s+\w*Transport\w*\s*\(/)?.[0] ?? null,
      'The service must not instantiate a transport. Anything it could construct is either a fake ' +
        'that reports deliveries which never happened (A8.4a audit H3) or a real sender it has no ' +
        'business authorizing (A8.4b.1). Both arrive from outside.',
    ).toBe(null);
    expect(service).not.toContain('createGmailReminderTransport');
  });

  it('does not even import the fake transport class', () => {
    expect(service).not.toContain('FakeReminderTransport');
    // The type-only import of the interface is the whole dependency the service is allowed.
    expect(service).toMatch(
      /import\s+type\s*\{[^}]*ReminderTransport[^}]*\}\s*from\s*'\.\/transport'/,
    );
  });

  it('refuses to proceed when no transport was injected', () => {
    // The fail-closed branch must be reached before any database work, which is why it is checked
    // in the same expression as the feature flag and returns before the runtime is loaded.
    const guardIndex = service.indexOf('!deliveryEnabled || !transportConfigured');
    expect(
      guardIndex,
      'expected a combined disabled/unconfigured fail-closed guard',
    ).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(service.indexOf('loadDbRuntime()'));
    expect(service).toContain('transportConfigured');
  });

  it('the fake never defaults to acceptance', () => {
    const transport = readCode(path.join(webRoot, 'lib/reminders/transport.ts'));
    expect(transport).toContain('transport_not_configured');
    expect(
      transport.match(/defaultResult\s*(\?\?|=)\s*\{\s*\n?\s*kind:\s*'accepted'/)?.[0] ?? null,
      'An unscripted fake must never report acceptance.',
    ).toBe(null);
  });

  /**
   * A8.4b.1: the flag decides whether a Gmail object is *built*, not just whether it is used.
   *
   * The A8.4a version of this guard asserted the route injected nothing at all, which was true and is
   * no longer the design. The replacement is the stronger property that took its place: with the flag
   * unset, `composeTransportProvider` returns before touching Gmail, so no access resolver exists, no
   * refresh token is decrypted, and no token exchange is attempted. "Disabled implies no Gmail
   * contact" is then a fact about the composition rather than a promise made further down the stack.
   */
  it('composes no Gmail transport at all unless the flag is exactly on', () => {
    const route = readCode(path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'));
    const compose = extractFunction(route, 'composeTransportProvider');
    const flagIndex = compose.indexOf('isReminderDeliveryEnabled()');
    const constructIndex = compose.indexOf('createGmailReminderTransportProvider(');
    expect(flagIndex, 'expected the flag to be checked in the composition root').toBeGreaterThan(
      -1,
    );
    expect(constructIndex).toBeGreaterThan(flagIndex);
    // The early return between them is what makes the ordering load-bearing rather than incidental.
    expect(compose.slice(flagIndex, constructIndex)).toMatch(/return\s+undefined/);
  });

  it('fails closed when the Owner organization is not configured', () => {
    const route = readCode(path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'));
    const compose = extractFunction(route, 'composeTransportProvider');
    const orgIndex = compose.indexOf('getReminderDeliveryOrganizationId()');
    expect(orgIndex).toBeGreaterThan(-1);
    expect(orgIndex).toBeLessThan(compose.indexOf('createGmailReminderTransportProvider('));
    expect(compose).toMatch(/if\s*\(!organizationId\)/);
  });
});

/**
 * A8.4b.1: the real Gmail reminder transport, and every way it must stay out of reach.
 */
describe('A8.4b.1: the reminder transport cannot be reached by accident', () => {
  const adapterPath = 'lib/gmail/outbound/reminder-transport.ts';
  const adapter = readCode(path.join(webRoot, adapterPath));
  const providerPath = 'lib/gmail/reminder-transport-provider.ts';
  const provider = readCode(path.join(webRoot, providerPath));
  const email = readCode(path.join(webRoot, 'lib/gmail/outbound/reminder-email.ts'));
  const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));

  /**
   * The send half and the authorization half are two files because two guards point in opposite
   * directions and both are right: `lib/reminders` may import no provider, and A7.4's
   * `gmail-transport-packaging.test.ts` forbids anything under `lib/gmail/outbound` from importing
   * the database layer — so that message construction and provider I/O cannot reach persistence and
   * quietly mutate handoff state. Asserting the split here records *why* it exists, so a later slice
   * that merges the files back together fails with the reason rather than with a stale path.
   */
  it('keeps the sender free of persistence and the authorization out of the outbound directory', () => {
    expect(adapter).not.toMatch(/from\s+['"]@aicaa\/db(\/[^'"]*)?['"]/);
    expect(adapter).not.toMatch(/from\s+['"]@\/lib\/db\//);
    expect(adapter).not.toContain('createGmailAccessResolver');
    // And the composition point is the only place the two meet.
    expect(provider).toContain('createGmailAccessResolver');
    expect(provider).toContain('createGmailReminderTransport');
  });

  it('resolves the access token in exactly one place and passes it as an argument', () => {
    // A second resolver would be a second refresh-token decryption and a second scope evaluation,
    // free to disagree with A7's. The adapter must therefore never learn where its token came from.
    expect((provider.match(/accessResolver\.resolve\(/g) ?? []).length).toBe(1);
    expect(adapter).toContain('deps.accessToken');
    expect(adapter).not.toMatch(/refreshToken|granted_scopes|grantedScopes/i);
  });

  it('refuses to build a real sender under an automated test runner', () => {
    // The only protection in this file that also covers tests nobody has written yet.
    expect(adapter).toContain('ReminderTransportTestEnvironmentError');
    const resolver = extractFunction(adapter, 'resolveRawSender');
    expect(resolver).toContain('isAutomatedTestEnvironment()');
    expect(resolver).toMatch(/throw\s+new\s+ReminderTransportTestEnvironmentError/);
    // The real sender must be the last resort, after both the injection and the test check.
    expect(resolver.indexOf('sendRawMessage')).toBeGreaterThan(
      resolver.indexOf('isAutomatedTestEnvironment()'),
    );
  });

  it('never reuses an A7 handoff send path for a reminder', () => {
    for (const forbidden of [
      'createHandoffTransportPort',
      'createGmailTransport',
      'buildAssignmentEmail',
      'buildGmailForward',
      'createOutboundMessagePreparer',
      'runInitialHandoff',
      'runHandoffRetry',
    ]) {
      for (const [label, source] of [
        [adapterPath, adapter],
        [providerPath, provider],
      ] as const) {
        expect(
          source.includes(forbidden),
          `${label} must not route a reminder through A7 handoff code (${forbidden}).`,
        ).toBe(false);
      }
    }
  });

  it('adds no threading, CC, or BCC', () => {
    for (const forbidden of [/threadId/, /\bcc\s*:/i, /\bbcc\b/i, /In-Reply-To/i, /References/]) {
      for (const source of [adapter, provider, email]) {
        expect(source.match(forbidden)?.[0] ?? null).toBe(null);
      }
    }
  });

  it('builds no capability, link, or URL into a reminder (D130)', () => {
    for (const source of [adapter, provider, email]) {
      for (const forbidden of [
        /buildCapabilityUrl/,
        /capabilityUrl/,
        /issueCapability/,
        /mintCapability/,
        /https?:\/\//,
        /<a\s+href/i,
      ]) {
        expect(source.match(forbidden)?.[0] ?? null).toBe(null);
      }
    }
  });

  it('never stores or logs a token, a raw response, or a MIME body', () => {
    for (const source of [adapter, provider, email]) {
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/logger?\.(info|warn|error|debug)/);
    }
    // The only thing kept from an acceptance is the provider message id, in exactly one place.
    const send = adapter.slice(adapter.indexOf('async send('));
    expect(send).toContain('providerMessageRef: response.id');
    expect((send.match(/providerMessageRef/g) ?? []).length).toBe(1);
    expect(send).not.toMatch(/response\.(headers|body|text|raw|threadId)/);
  });

  it('resolves authorization exactly once, before the first claim', () => {
    const resolveIndex = service.indexOf('provider.resolve()');
    expect(resolveIndex, 'expected a once-per-invocation authorization resolution').toBeGreaterThan(
      -1,
    );
    // Exactly one call site: a second would be a second resolution per invocation.
    expect((service.match(/provider\.resolve\(\)/g) ?? []).length).toBe(1);
    for (const laterWork of [
      'settleUnsettledOccurrences(context',
      'listDueReminderSchedulesGlobally',
      'claimReminderScheduleForProcessing',
      'claimReminderOccurrence',
    ]) {
      const index = service.indexOf(laterWork);
      expect(index, `expected to find ${laterWork}`).toBeGreaterThan(-1);
      expect(
        resolveIndex,
        `authorization must be resolved before ${laterWork}: an unusable connection must cost ` +
          'zero claims and zero writes (A8.4b.1).',
      ).toBeLessThan(index);
    }
  });

  it('checks the capability state before the provider marker and the send', () => {
    // Execution order, read from the one function that performs all three steps in sequence. The
    // gate itself lives in `evaluatePreSendGuards`, which is declared further down the file — so
    // comparing declaration positions would prove nothing about the order things happen in.
    const occurrence = extractFunction(service, 'processOneOccurrence');
    const guardIndex = occurrence.indexOf('evaluatePreSendGuards(');
    const markerIndex = occurrence.indexOf('markProviderCallStarted');
    const sendIndex = occurrence.indexOf('transport.send(');
    expect(
      guardIndex,
      'expected the pre-send guards to run in the occurrence path',
    ).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(markerIndex);
    expect(markerIndex).toBeLessThan(sendIndex);
    // A skip verdict must return rather than fall through to the marker and the call.
    expect(occurrence.slice(guardIndex, markerIndex)).toMatch(/kind === 'skip'[\s\S]*return;/);

    const guards = extractFunction(service, 'evaluatePreSendGuards');
    expect(guards, 'expected a D130 capability gate').toContain("capabilityState !== 'actionable'");
    expect(guards).toContain('no_actionable_capability');
  });

  it('reads the capability from the same snapshot as everything else it gates on', () => {
    const transactions = readCode(path.join(dbSrc, 'transactions/a8-reminder-transactions.ts'));
    const snapshot = extractFunction(transactions, 'readReminderPreSendSnapshot');
    expect(snapshot).toMatch(/isolationLevel:\s*'RepeatableRead'/);
    expect(snapshot).toContain('taskCapability.findFirst');
    // One transaction, so the capability cannot be true of a different instant than the schedule.
    expect((snapshot.match(/\$transaction\(/g) ?? []).length).toBe(1);
  });
});

/**
 * H1: terminalizing an occurrence and settling its schedule are two transactions.
 *
 * The single-transaction design claimed phase two could not abort phase one because every write was
 * a conditional update. Fault injection raised a CHECK violation inside phase two and watched the
 * recorded delivery vanish with the rollback. The guard rejects a return to the shared transaction
 * on the design rather than on the timing.
 */
describe('H1: settlement cannot roll back a recorded delivery', () => {
  const safe = readCode(path.join(dbSrc, 'transactions/a8-4a-occurrence-transactions.ts'));

  it('has a separate, independently callable settlement transaction', () => {
    expect(safe).toContain('export async function terminalizeReminderOccurrence');
    expect(safe).toContain('export async function settleReminderOccurrenceSchedule');
    // Two `$transaction` calls, not one shared block.
    expect((safe.match(/\$transaction\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('applies the schedule effect only inside the settlement transaction', () => {
    const terminalize = extractFunction(safe, 'terminalizeReminderOccurrence');
    expect(
      terminalize,
      'Phase A must record the occurrence and nothing else. A schedule write here is the shared ' +
        'transaction returning under a new name.',
    ).not.toContain('applyScheduleEffect');
    expect(extractFunction(safe, 'settleReminderOccurrenceSchedule')).toContain(
      'applyScheduleEffect',
    );
  });

  it('gates settlement on a durable marker rather than on inference', () => {
    expect(safe).toContain('scheduleSettledAt');
    const settle = extractFunction(safe, 'settleReminderOccurrenceSchedule');
    // The marker is re-read after the Task lock, which is what makes two settlers serialize.
    const lockIndex = settle.indexOf('lockTaskScopeForReminderMutation(');
    const markerIndex = settle.indexOf('scheduleSettledAt !== null');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeGreaterThan(lockIndex);
  });

  it('the processing service treats a settlement failure as debt, not as a failed send', () => {
    const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));
    expect(service).toContain('settlementDeferred');
    expect(service).toContain('settleUnsettledOccurrences');
  });
});

/**
 * B1 and B2: the two states the audit found a schedule could enter and never leave.
 */
describe('recovery leaves no schedule permanently stuck', () => {
  it('ambiguous recovery is given a next occurrence to arm (B1)', () => {
    const safe = readCode(path.join(dbSrc, 'transactions/a8-4a-occurrence-transactions.ts'));
    const recover = extractFunction(safe, 'finalizeAbandonedInFlightOccurrence');
    expect(
      recover.match(/nextOverdueOccurrence:\s*null/)?.[0] ?? null,
      'Recovery used to hard-code null here, which settlement wrote through as a disarmed but ' +
        'still-active schedule: the reminder series ended and nothing recorded that it had.',
    ).toBe(null);
    expect(recover).toContain('nextOverdueOccurrence: input.nextOverdueOccurrence');
  });

  it('the worker computes recovery occurrences with the one domain algorithm', () => {
    const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));
    // A single helper, so recovery and the live path cannot drift into two calendars.
    expect((service.match(/selectNextOverdueOccurrence\(/g) ?? []).length).toBe(1);
    expect((service.match(/nextOccurrenceFor\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('an exhausted retry budget has a terminalization path (B2)', () => {
    const safe = readCode(path.join(dbSrc, 'transactions/a8-4a-occurrence-transactions.ts'));
    expect(safe).toContain('export async function terminalizeExhaustedRetryOccurrence');
    const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));
    expect(service).toContain('terminalizeExhaustedOccurrences');
    // It must run before the due scan, or the loop survives one more invocation than it needs to.
    expect(service.indexOf('terminalizeExhaustedOccurrences(context')).toBeLessThan(
      service.indexOf('listDueReminderSchedulesGlobally'),
    );
  });

  it('recovery discharges every class of debt before scanning for new work', () => {
    const service = readCode(path.join(webRoot, 'lib/reminders/process-service.ts'));
    const order = [
      'settleUnsettledOccurrences(context',
      'recoverAbandonedClaims(context',
      'terminalizeExhaustedOccurrences(context',
      'listDueReminderSchedulesGlobally',
    ].map((needle) => service.indexOf(needle));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

/**
 * H2: a retry takeover resets the provider boundary.
 *
 * The marker answers "did *this attempt* contact a provider?". Inheriting the previous attempt's
 * answer made a crash before the new call indistinguishable from a crash during it, so a reminder
 * that provably never left was finalized ambiguous and its local day consumed.
 */
describe('H2: retry takeover clears the previous attempt provider state', () => {
  it('the takeover write nulls the marker, the acceptance, and the message reference', () => {
    const repository = readCode(
      path.join(dbSrc, 'repositories/reminder-delivery-attempt-repository.ts'),
    );
    const takeover = extractFunction(repository, 'takeOverOccurrence');
    for (const field of [
      'providerCallStartedAt: null',
      'providerAcceptedAt: null',
      'providerMessageRef: null',
      'scheduleSettledAt: null',
    ]) {
      expect(takeover, `takeover must clear ${field}`).toContain(field);
    }
  });
});

/**
 * L2: one response finalizer, so there is no branch left to forget the header on.
 */
describe('the internal endpoint marks every response no-store', () => {
  const route = readCode(path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'));

  it('sets the header once, outside the branching', () => {
    expect(route).toContain("response.headers.set('Cache-Control', 'no-store')");
    expect(route).toContain('return noStore(response)');
  });

  it('does not attach the header per-branch, where a new branch could miss it', () => {
    expect(route).not.toMatch(/NextResponse\.json\([^)]*headers/);
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
