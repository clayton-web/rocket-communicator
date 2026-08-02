import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.5b structural guards (D133, D135, D136).
 *
 * These read the source and fail on the *design*, not on the timing. A concurrency test can only
 * catch a misordered write when it happens to interleave badly; a guard that reads the code catches
 * the shape that makes the bad interleaving possible, deterministically, on every run, with no
 * database — the reasoning behind the A8.4a guards, applied to the notification worker.
 *
 * Several of these encode promises made in the A8.5b completion report. If a later slice makes one
 * of them false, the promise has changed and the report needs to change with it.
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

const SERVICE = path.join(webRoot, 'lib/notifications/process-service.ts');
const CONFIG = path.join(webRoot, 'lib/notifications/process-config.ts');
const TRANSPORT = path.join(webRoot, 'lib/notifications/transport.ts');
const ROUTE = path.join(webRoot, 'app/api/v1/internal/notifications/process/route.ts');
const DB_REPOSITORY = path.join(dbSrc, 'repositories/owner-notification-repository.ts');
const DB_TRANSACTIONS = path.join(dbSrc, 'transactions/a8-5b-notification-transactions.ts');

const A8_5B_MODULES = [SERVICE, CONFIG, TRANSPORT, ROUTE, DB_REPOSITORY, DB_TRANSACTIONS];

describe('A8.5b never reaches a real transport', () => {
  /**
   * A8.5b's only implementation is a fake. If any of these appears, the slice has grown a Gmail
   * adapter, an email renderer, or a token resolver, and the claim that no Gmail contact is possible
   * has stopped being structural.
   */
  const FORBIDDEN_DEPENDENCIES: readonly (readonly [RegExp, string])[] = [
    [/googleapis/, 'the Google API SDK'],
    [/google-auth-library/, 'the Google auth library'],
    [/\bgmail\b/i, 'anything Gmail'],
    [/reminder-transport/, 'the reminder transport'],
    [/reminder-email/, 'the reminder email renderer'],
    [/resolveGmailAccess|AccessTokenResolver|refreshAccessToken/, 'an access-token resolver'],
    [/buildMime|toRfc822|createMimeMessage/, 'a MIME builder'],
    [/X-Rocket-Generated/, 'the D136 self-ingestion marker (A8.5c)'],
  ];

  /**
   * The one allowed match, and the reason it is not a loophole.
   *
   * `authorizeCronRequest` lives under `lib/gmail/` for historical reasons — the Gmail poll was the
   * first internal endpoint to need it — and is the shared cron bearer check that the reminder and
   * suggestion workers also import. It reads `CRON_SECRET` and compares strings; it holds no OAuth
   * credential, constructs no client, and sends nothing. Excluding this exact specifier keeps the
   * guard sharp: any other reference to Gmail in these modules still fails.
   */
  const SHARED_CRON_AUTH = /@\/lib\/gmail\/cron-auth/g;

  it.each(A8_5B_MODULES)('%s imports no provider layer', (modulePath) => {
    const code = readCode(modulePath).replace(SHARED_CRON_AUTH, '@/lib/cron-auth');
    for (const [pattern, description] of FORBIDDEN_DEPENDENCIES) {
      expect(
        pattern.test(code),
        `${path.relative(repoRoot, modulePath)} references ${description}. A8.5b delivers through ` +
          'a fail-closed fake only; the real adapter is A8.5c.',
      ).toBe(false);
    }
  });

  it('has no Owner notification email renderer anywhere', () => {
    for (const candidate of ['lib/notifications/email.ts', 'lib/notifications/render.ts']) {
      expect(
        existsSync(path.join(webRoot, candidate)),
        `${candidate} exists. Composing an Owner notification message is A8.5c.`,
      ).toBe(false);
    }
  });

  it('gives the transport identity and gives it nowhere to put content', () => {
    const code = readCode(TRANSPORT);
    const request = code.slice(code.indexOf('interface OwnerNotificationTransportRequest'));
    for (const field of ['email', 'address', 'subject', 'body', 'html', 'token', 'url', 'note']) {
      expect(
        new RegExp(`\\b${field}\\b`, 'i').test(request.slice(0, request.indexOf('}'))),
        `The transport request exposes a "${field}" field, which D130 and D134 rely on it not ` +
          'having: the address is resolved at send time and no capability link is ever included.',
      ).toBe(false);
    }
  });
});

describe('A8.5b delivery gating', () => {
  it('checks the flag before it can reach the database', () => {
    const code = readCode(SERVICE);
    const flagIndex = code.indexOf('isOwnerEventDeliveryEnabled(');
    const runtimeIndex = code.indexOf('loadDbRuntime()');

    expect(flagIndex, 'the service must read the delivery flag').toBeGreaterThan(-1);
    expect(runtimeIndex, 'the service must load the runtime').toBeGreaterThan(-1);
    expect(
      flagIndex < runtimeIndex,
      'The delivery flag must be evaluated before `loadDbRuntime`, so a disabled invocation opens ' +
        'no connection and issues no statement against either A8.5 table (D135).',
    ).toBe(true);

    // And the early return sits between them, so the ordering is a refusal rather than a sequence.
    const between = code.slice(flagIndex, runtimeIndex);
    expect(between).toMatch(/if\s*\(!deliveryEnabled[\s\S]*?return\s*\{/);
  });

  it('opts in by exact string, with no coercion', () => {
    const code = readCode(CONFIG);
    expect(code).toMatch(/===\s*'true'/);
    for (const loose of ['toLowerCase', 'trim(', 'Boolean(', '!!env', 'includes('])
      expect(
        code.includes(loose),
        `The flag must not be normalized with ${loose}: "TRUE", " true", and "1" are near misses ` +
          'that must stay disabled.',
      ).toBe(false);
  });

  it('never reads or writes the reminder delivery flag', () => {
    for (const modulePath of A8_5B_MODULES) {
      expect(
        readCode(modulePath).includes('ENABLE_REMINDER_DELIVERY'),
        `${path.relative(repoRoot, modulePath)} touches ENABLE_REMINDER_DELIVERY. The two engines ` +
          'are gated independently and neither may read the other flag.',
      ).toBe(false);
    }
  });

  it('does not enable any flag in a repository environment file', () => {
    const example = readFileSync(path.join(webRoot, '.env.example'), 'utf8');
    expect(example).not.toMatch(/^\s*ENABLE_OWNER_EVENT_DELIVERY\s*=\s*true/m);
    expect(example).not.toMatch(/^\s*ENABLE_OWNER_EVENT_CAPTURE\s*=\s*true/m);
    expect(example).not.toMatch(/^\s*ENABLE_REMINDER_DELIVERY\s*=\s*true/m);
  });
});

describe('A8.5b crash boundaries', () => {
  it('marks the provider call started before it invokes the transport', () => {
    const code = readCode(SERVICE);
    const markIndex = code.indexOf('beginOwnerNotificationAttempt(');
    const sendIndex = code.indexOf('transport.send(');

    expect(markIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(-1);
    expect(
      markIndex < sendIndex,
      'The in-flight marker must be durable before the provider is contacted. Reversed, a worker ' +
        'that dies mid-call is indistinguishable from one that died before calling, and recovery ' +
        'must choose between never delivering and delivering twice.',
    ).toBe(true);
  });

  it('holds no database transaction across the transport call', () => {
    const code = readCode(SERVICE);
    expect(
      code.includes('$transaction'),
      'The processing service must not open a transaction at all. Every transaction it needs is ' +
        'inside a persistence function that returns before the transport is invoked; one opened ' +
        'here could enclose the network call and hold row locks for as long as a provider hangs.',
    ).toBe(false);
  });

  it('settles the transport result under the fence taken at claim time', () => {
    const code = readCode(SERVICE);
    const settleCall = code.slice(code.lastIndexOf('settleOwnerNotificationAttempt({'));
    expect(settleCall).toMatch(/claimSequence:\s*claim\.claimSequence/);
  });

  it('recovers an in-flight lease without calling the transport again', () => {
    const code = readCode(SERVICE);
    const recovery = code.slice(
      code.indexOf('listExpiredOwnerNotificationClaims('),
      code.indexOf('listClaimableOwnerNotificationIntents('),
    );
    expect(recovery).toContain('recoverExpiredOwnerNotificationClaim');
    expect(
      recovery.includes('transport.send'),
      'Recovery must never contact the provider. A lapsed lease whose call had started is ' +
        'ambiguous, and resending it is exactly the duplicate D135 refuses.',
    ).toBe(false);
    expect(recovery).toMatch(/kind:\s*'ambiguous'/);
  });
});

describe('A8.5b terminal outcomes are truthful', () => {
  it('never maps an ambiguous outcome to sent', () => {
    const code = readCode(DB_TRANSACTIONS);
    const transition = code.slice(
      code.indexOf('function intentTransitionFor'),
      code.indexOf('function attemptOutcomeFor'),
    );
    const ambiguousBranch = transition.slice(transition.indexOf("case 'ambiguous':"));
    expect(ambiguousBranch).toMatch(/state:\s*'ambiguous'/);
    expect(
      /state:\s*'sent'/.test(ambiguousBranch.slice(0, ambiguousBranch.indexOf('}') + 1)),
      'An ambiguous provider answer must never be recorded as delivered. This is the deliberate ' +
        'divergence from the reminder rule, where D106 made a possible duplicate the worse outcome.',
    ).toBe(false);
  });

  it('never returns a spent retry budget to pending', () => {
    const code = readCode(DB_TRANSACTIONS);
    const transition = code.slice(
      code.indexOf('function intentTransitionFor'),
      code.indexOf('function attemptOutcomeFor'),
    );
    const exhausted = transition.slice(
      transition.indexOf("case 'exhausted':"),
      transition.indexOf("case 'failed_permanent':"),
    );
    expect(exhausted).toMatch(/state:\s*'requires_owner_attention'/);
    expect(exhausted).toMatch(/terminal:\s*true/);
    expect(exhausted).not.toMatch(/state:\s*'pending'/);
  });

  it('requires an audit event for every terminal settlement', () => {
    const code = readCode(DB_TRANSACTIONS);
    expect(code).toMatch(/if\s*\(transition\.terminal\s*&&\s*!input\.audit\)/);
    expect(code).toMatch(/throw new Error\(/);
  });

  it('attributes delivery to the system and never to the triggering actor', () => {
    const code = readCode(SERVICE);
    const audit = code.slice(
      code.indexOf('function terminalAudit'),
      code.indexOf('function settlementFor'),
    );
    expect(audit).toMatch(/actorKind:\s*'system'/);
    for (const borrowed of ['ownerId', 'capabilityId', 'assignmentId', 'attributionLabel']) {
      expect(
        audit.includes(borrowed),
        `The delivery audit copies ${borrowed} from the intent. The Owner is the audience of the ` +
          'event and the worker is the actor of the send; merging them would say the Recipient ' +
          'emailed the Owner.',
      ).toBe(false);
    }
  });

  it('records only closed failure codes, never a provider or exception string', () => {
    const code = readCode(SERVICE);
    const catchBlock = code.slice(code.indexOf('} catch {'), code.indexOf('const settlement ='));
    expect(catchBlock).toMatch(/NOTIFICATION_FAILURE_CODES\.transportThrew/);
    for (const leak of ['error.message', 'String(error)', '`${error', 'error)']) {
      expect(
        catchBlock.includes(leak),
        `The transport catch block reaches for ${leak}. An arbitrary exception string is not a ` +
          'failure code and must not become durable.',
      ).toBe(false);
    }
  });
});

describe('A8.5b stays out of the reminder engine', () => {
  it('imports no reminder policy, counter, or generation', () => {
    const FORBIDDEN = [
      'MAX_OCCURRENCE_ATTEMPTS',
      'OCCURRENCE_CLAIM_LEASE_MS',
      'REMINDER_PROCESS_SYSTEM_ID',
      'CONSECUTIVE_AMBIGUOUS_STOP_THRESHOLD',
      'hasReachedConsecutiveAmbiguousStop',
      'hasReachedOverdueDeliveryCeiling',
      'OVERDUE_SUCCESSFUL_DELIVERY_CEILING',
      'generation',
      'occurrenceLocalDate',
      'runInternalReminderProcess',
    ];
    for (const modulePath of A8_5B_MODULES) {
      const code = readCode(modulePath);
      for (const symbol of FORBIDDEN) {
        expect(
          code.includes(symbol),
          `${path.relative(repoRoot, modulePath)} references ${symbol}. D135 declines reminder ` +
            'series policy for Owner notifications; borrowing its vocabulary is how the two ' +
            'policies start to drift into each other.',
        ).toBe(false);
      }
    }
  });

  it('keeps its own constants rather than re-exporting the reminder ones', () => {
    const code = readCode(CONFIG);
    expect(code).not.toMatch(/from\s*['"].*reminders/);
    expect(code).toMatch(/MAX_NOTIFICATION_ATTEMPTS\s*=\s*3/);
    expect(code).toMatch(/NOTIFICATION_STALENESS_HORIZON_MS\s*=\s*24\s*\*/);
  });

  it('does not modify the reminder worker route or service', () => {
    const reminderRoute = readCode(
      path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'),
    );
    expect(reminderRoute).not.toContain('notification');
    expect(reminderRoute).not.toContain('Notification');
  });
});

describe('A8.5b worker topology', () => {
  it('is its own endpoint with the established internal-worker shape', () => {
    const code = readCode(ROUTE);
    expect(code).toMatch(/export const runtime = 'nodejs'/);
    expect(code).toMatch(/export const maxDuration = 60/);
    expect(code).toContain('authorizeCronRequest');
    expect(code).toMatch(/export async function POST/);
    // POST only: a GET worker endpoint is reachable by a link preview or a crawler.
    expect(code).not.toMatch(/export async function GET/);
  });

  it('composes no transport, so the endpoint cannot deliver even if enabled', () => {
    const code = readCode(ROUTE);
    expect(
      /transport/i.test(code.slice(code.indexOf('export async function POST'))),
      'The A8.5b route must pass no transport at all. A default here would let a fake reach a ' +
        'real invocation, and there is no real implementation to pass instead until A8.5c.',
    ).toBe(false);
  });

  it('never invokes the reminder worker', () => {
    const code = readCode(ROUTE);
    expect(code).not.toContain('runInternalReminderProcess');
    expect(code).not.toContain('reminders/process');
  });

  it('adds no cron configuration', () => {
    const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
      crons?: unknown[];
    };
    expect(
      vercel.crons ?? [],
      'A8.5b creates no schedule. The endpoint is invoked by nothing.',
    ).toEqual([]);
  });
});

describe('A8.5b persistence boundary', () => {
  it('reads no clock in packages/db', () => {
    for (const modulePath of [DB_REPOSITORY, DB_TRANSACTIONS]) {
      const code = readCode(modulePath);
      for (const pattern of [/\bDate\.now\s*\(/, /new Date\s*\(\s*\)/]) {
        expect(
          pattern.test(code),
          `${path.relative(repoRoot, modulePath)} reads the clock. Every instant must arrive as an ` +
            'argument so one invocation decides "now" once (D103).',
        ).toBe(false);
      }
    }
  });

  it('restates no delivery policy in packages/db', () => {
    for (const modulePath of [DB_REPOSITORY, DB_TRANSACTIONS]) {
      const code = readCode(modulePath);
      expect(
        /\b24\s*\*\s*60|86_?400_?000|maxAttempts|MAX_ATTEMPTS/.test(code),
        `${path.relative(repoRoot, modulePath)} restates the staleness horizon or the attempt ` +
          'budget. Persistence is handed a conclusion; the numbers live in process-config.ts.',
      ).toBe(false);
    }
  });

  it('fences every state transition on the claim sequence', () => {
    const code = readCode(DB_TRANSACTIONS) + readCode(DB_REPOSITORY);
    const transitions = code.match(/ownerNotificationIntent\.updateMany\(\{[\s\S]*?\}\)/g) ?? [];
    expect(transitions.length).toBeGreaterThanOrEqual(4);
    for (const transition of transitions) {
      expect(
        /claimSequence:/.test(transition),
        'Every conditional update on an intent must name the claim sequence it expects. Without ' +
          'it a superseded worker can still win the compare-and-set.',
      ).toBe(true);
      expect(transition).toMatch(/organizationId:/);
    }
  });

  it('never introduces FOR UPDATE SKIP LOCKED', () => {
    for (const modulePath of [DB_REPOSITORY, DB_TRANSACTIONS]) {
      expect(readCode(modulePath)).not.toMatch(/SKIP\s+LOCKED/i);
    }
  });
});

describe('A8.5b persists no sensitive material', () => {
  it('stores no capability link, address, or Recipient text on an attempt', () => {
    const code = readCode(DB_TRANSACTIONS) + readCode(DB_REPOSITORY) + readCode(SERVICE);
    for (const forbidden of ['/c/', 'capabilityToken', 'tokenHash', 'recipientEmail', 'excerpt']) {
      expect(
        code.includes(forbidden),
        `A8.5b references ${forbidden}. Neither the attempt row nor the worker response may carry ` +
          'a capability link, an address, or Recipient free text (D109, D130).',
      ).toBe(false);
    }
  });

  it('returns an aggregate of counts and flags only', () => {
    const code = readCode(SERVICE);
    const aggregate = code.slice(
      code.indexOf('interface NotificationProcessAggregate'),
      code.indexOf('const ZERO_AGGREGATE'),
    );
    const fields = [...aggregate.matchAll(/readonly (\w+):\s*(\w+)/g)];
    expect(fields.length).toBeGreaterThan(10);
    for (const [, name, type] of fields) {
      expect(
        ['number', 'boolean', 'string'].includes(type!),
        `${name} is a ${type}. The worker response carries counts and flags only.`,
      ).toBe(true);
      if (type === 'string') {
        expect(name, 'the only string in the aggregate is the request id').toBe('requestId');
      }
    }
  });
});
