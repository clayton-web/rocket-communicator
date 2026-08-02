import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.5c structural guards (D133–D136).
 *
 * A real Gmail adapter now exists, which changes what the guards have to prove. A8.5b could assert
 * that no provider was reachable at all; A8.5c has to assert that the reachable one is reachable
 * only behind the flag, addresses only the connected account, persists no address, renders no
 * capability, and excludes only the marked message from ingestion.
 *
 * These read source rather than behaviour on purpose. A test can only catch the interleaving it
 * happens to produce; a guard that reads the code catches the shape that makes the bad case
 * possible, on every run, with no database and no provider.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.join(repoRoot, 'apps/web');
const domainSrc = path.join(repoRoot, 'packages/domain/src');
const dbSrc = path.join(repoRoot, 'packages/db/src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

/** SQL uses `--`, so migrations need their own comment stripper before a prose-blind read. */
function readSql(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8').replace(/^\s*--[^\n]*$/gm, '');
}

const RENDERER = path.join(webRoot, 'lib/gmail/outbound/owner-notification-email.ts');
const ADAPTER = path.join(webRoot, 'lib/gmail/outbound/owner-notification-transport.ts');
const PROVIDER = path.join(webRoot, 'lib/gmail/owner-notification-transport-provider.ts');
const ROUTE = path.join(webRoot, 'app/api/v1/internal/notifications/process/route.ts');
const SERVICE = path.join(webRoot, 'lib/notifications/process-service.ts');
const MIME = path.join(webRoot, 'lib/gmail/transport/mime.ts');
const OUTBOUND_TYPES = path.join(webRoot, 'lib/gmail/transport/outbound-types.ts');
const SYNC_ENGINE = path.join(webRoot, 'lib/gmail/sync-engine.ts');
const NORMALIZE = path.join(webRoot, 'lib/gmail/normalize.ts');
const DOMAIN_GMAIL = path.join(domainSrc, 'value-objects/gmail.ts');

describe('A8.5c: the real transport is reachable only behind the delivery flag', () => {
  it('checks the flag before it constructs anything or reads any configuration', () => {
    const code = readCode(ROUTE);
    const compose = code.slice(code.indexOf('async function composeTransport'));
    const flagIndex = compose.indexOf('!isOwnerEventDeliveryEnabled()');
    const constructIndex = compose.indexOf('createGmailOwnerNotificationTransportProvider');
    const runtimeIndex = compose.indexOf('loadDbRuntime()');

    expect(flagIndex).toBeGreaterThan(-1);
    expect(flagIndex).toBeLessThan(constructIndex);
    expect(flagIndex).toBeLessThan(runtimeIndex);
    // The early return between them makes the ordering a refusal rather than a sequence.
    expect(compose.slice(flagIndex, constructIndex)).toMatch(
      /!isOwnerEventDeliveryEnabled\(\)\)\s*\{\s*return undefined;/,
    );
  });

  it('gates on that flag alone, and never on the reminder flag', () => {
    for (const modulePath of [ROUTE, ADAPTER, PROVIDER, RENDERER]) {
      const code = readCode(modulePath);
      expect(
        code.includes('ENABLE_REMINDER_DELIVERY'),
        `${path.relative(repoRoot, modulePath)} reads the reminder flag. The two engines are gated ` +
          'independently and neither may read the other.',
      ).toBe(false);
    }
  });

  it('refuses the real sender under a test runner instead of substituting a stub', () => {
    const code = readCode(ADAPTER);
    expect(code).toContain('OwnerNotificationTransportTestEnvironmentError');
    expect(code).toMatch(/env\.VITEST === 'true'/);
    const resolve = code.slice(code.indexOf('function resolveRawSender'));
    expect(
      resolve.slice(0, resolve.indexOf('return sendRawMessage')),
      'The guard must throw. A silent no-op sender would let a test that forgot to inject a fake ' +
        'pass while asserting nothing.',
    ).toContain('throw new OwnerNotificationTransportTestEnvironmentError()');
  });

  it('enables no flag in a repository environment file', () => {
    const example = readFileSync(path.join(webRoot, '.env.example'), 'utf8');
    for (const flag of [
      'ENABLE_OWNER_EVENT_DELIVERY',
      'ENABLE_OWNER_EVENT_CAPTURE',
      'ENABLE_REMINDER_DELIVERY',
    ]) {
      expect(example).not.toMatch(new RegExp(`^\\s*${flag}\\s*=\\s*true`, 'm'));
    }
  });

  it('adds no cron', () => {
    const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
      crons?: unknown[];
    };
    expect(vercel.crons ?? []).toEqual([]);
  });
});

describe('A8.5c: the destination comes only from the connected account', () => {
  it('resolves it from CommunicationAccount, through the shared access resolver', () => {
    const code = readCode(PROVIDER);
    expect(code).toContain('createGmailAccessResolver');
    // `access.from` is `CommunicationAccount.emailAddress`, and it is both ends of the message.
    expect(code).toMatch(/mailbox:\s*access\.from/);
  });

  it('gives the adapter no destination parameter at all', () => {
    const code = readCode(ADAPTER);
    const deps = code.slice(
      code.indexOf('interface GmailOwnerNotificationTransportDeps'),
      code.indexOf('export function classifyOwnerNotificationFailure'),
    );
    for (const field of ['to:', 'recipientEmail', 'destination', 'toAddress']) {
      expect(
        deps.includes(field),
        `The adapter accepts "${field}". A destination that can be passed in is a destination a ` +
          'Task, a Recipient, or a caller can choose (D134).',
      ).toBe(false);
    }
    // The one place `to` is set reads the authorized mailbox and nothing else.
    expect(code).toMatch(/to:\s*authorization\.mailbox/);
  });

  it('reads no Recipient row, address, or free text', () => {
    for (const modulePath of [RENDERER, ADAPTER, PROVIDER, ROUTE]) {
      const code = readCode(modulePath);
      // Identifiers that would *read* Recipient-authored text, rather than words that merely name an
      // event. `task_clarification_requested` is in the ratified taxonomy and the renderer has fixed
      // copy for it; announcing that a clarification was requested is the notification, and quoting
      // what was asked is what D134 forbids.
      for (const forbidden of [
        'getRecipientById',
        'listRecipients',
        'recipient.email',
        'recipientEmail',
        'intendedRecipientEmail',
        'getTaskNotes',
        'TaskNote',
        'noteBody',
        'clarificationText',
        'clarificationRequest',
        'TemporaryCommunicationExcerpt',
        'excerptContent',
      ]) {
        expect(
          code.includes(forbidden),
          `${path.relative(repoRoot, modulePath)} references ${forbidden}. An Owner notification ` +
            'states the event and identifies the Task; it quotes nothing a Recipient wrote (D134).',
        ).toBe(false);
      }
    }
  });

  it('lets no Task or event field select a destination', () => {
    const provider = readCode(PROVIDER);
    // The Task read exists, and it feeds summary lines only. If an address ever came out of it, it
    // would have to pass through here.
    const contextFn = provider.slice(
      provider.indexOf('export async function resolveOwnerNotificationContext'),
      provider.indexOf('export function createGmailOwnerNotificationTransportProvider'),
    );
    expect(contextFn).toContain('summaryLines');
    for (const field of ['email', 'address', 'mailbox']) {
      expect(
        new RegExp(`\\b${field}\\b`, 'i').test(contextFn),
        `The render context mentions "${field}". It carries what the message says, never where it ` +
          'goes.',
      ).toBe(false);
    }
  });

  it('persists no destination on the intent or attempt tables', () => {
    const repository = readCode(path.join(dbSrc, 'repositories/owner-notification-repository.ts'));
    const transactions = readCode(
      path.join(dbSrc, 'transactions/a8-5b-notification-transactions.ts'),
    );
    const migration = readSql(
      path.join(
        repoRoot,
        'packages/db/prisma/migrations/20260803120000_a8_5a_owner_notification_intents/migration.sql',
      ),
    );
    for (const source of [repository, transactions, migration]) {
      for (const field of ['email', 'destination', 'recipient_email', 'mailbox']) {
        expect(source.toLowerCase().includes(field)).toBe(false);
      }
    }
  });

  it('returns no address in the worker aggregate', () => {
    const code = readCode(SERVICE);
    const aggregate = code.slice(
      code.indexOf('interface NotificationProcessAggregate'),
      code.indexOf('const ZERO_AGGREGATE'),
    );
    for (const field of ['email', 'address', 'mailbox', 'subject', 'body']) {
      expect(aggregate.toLowerCase().includes(field)).toBe(false);
    }
  });
});

describe('A8.5c: the rendered message carries no credential', () => {
  it('mints, reads, and formats no capability anywhere in rendering', () => {
    for (const modulePath of [RENDERER, ADAPTER, PROVIDER]) {
      const code = readCode(modulePath);
      for (const forbidden of [
        'buildCapabilityUrl',
        'issueCapability',
        'mintCapability',
        'capabilityToken',
        'tokenHash',
        'CAPABILITY_TOKEN_PEPPER',
      ]) {
        expect(
          code.includes(forbidden),
          `${path.relative(repoRoot, modulePath)} references ${forbidden}. An Owner is not a ` +
            'bearer, and this message must contain no credential (D109, D130).',
        ).toBe(false);
      }
    }
  });

  it('refuses a rendered body containing a /c/ path rather than emitting one', () => {
    // Raw, not comment-stripped: the pattern `/\/c\//i` contains a literal `//`, which the comment
    // stripper reasonably mistakes for the start of a line comment.
    const raw = readFileSync(RENDERER, 'utf8');
    expect(raw).toContain('const CAPABILITY_PATH_LIKE = /\\/c\\//i');

    const code = readCode(RENDERER);
    expect(code).toContain('assertOwnerLinkSafety');
    // Both alternatives are checked, because a rule kept in text and broken in HTML is broken.
    expect(code).toMatch(/assertOwnerLinkSafety\(textBody, 'text'/);
    expect(code).toMatch(/assertOwnerLinkSafety\(htmlBody, 'html'/);
  });

  it('escapes every interpolated value in the HTML alternative', () => {
    const code = readCode(RENDERER);
    const html = code.slice(
      code.indexOf('function buildHtml'),
      code.indexOf('export function buildOwnerNotificationEmail'),
    );
    // Every `${...}` inside the HTML builder is either an escapeHtml call or an already-validated
    // absolute URL bound to `href`.
    const interpolations = html.match(/\$\{[^}]+\}/g) ?? [];
    expect(interpolations.length).toBeGreaterThan(0);
    for (const interpolation of interpolations) {
      expect(
        /escapeHtml\(|href|\bcopy\.|^\$\{href\}$/.test(interpolation),
        `Unescaped HTML interpolation ${interpolation}.`,
      ).toBe(true);
    }
  });

  it('stamps the fixed marker in rendering, so no path can build an unmarked notification', () => {
    const code = readCode(RENDERER);
    expect(code).toContain('rocketGenerated: ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION');
    // Set by the renderer rather than the transport: an unmarked Owner notification is precisely the
    // message that would be ingested back into A6.
    expect(readCode(ADAPTER)).not.toContain('rocketGenerated:');
  });
});

describe('A8.5c: the MIME builder still admits no arbitrary header', () => {
  it('exposes one closed marker field and no header map', () => {
    const types = readCode(OUTBOUND_TYPES);
    expect(types).toMatch(/rocketGenerated\?:\s*RocketGeneratedMarker/);
    for (const forbidden of [
      'headers?:',
      'extraHeaders',
      'customHeaders',
      'Record<string, string>',
    ]) {
      expect(
        types.includes(forbidden),
        `OutboundMimeMessage exposes ${forbidden}. Header injection is unreachable today because ` +
          'the header set is fixed; a caller-controlled map would end that.',
      ).toBe(false);
    }
  });

  it('owns the header name and validates the value before emitting it', () => {
    const code = readCode(MIME);
    expect(code).toContain('ROCKET_GENERATED_HEADER_NAME');
    const emission = code.slice(code.indexOf('if (message.rocketGenerated !== undefined)'));
    expect(emission).toContain('!== ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION');
    expect(emission).toContain('throw new MimeConstructionError');
    // One push from one scalar field, so a duplicate marker is not emittable.
    expect((emission.match(/topHeaders\.push/g) ?? []).length).toBe(1);
  });

  it('leaves assignment and reminder rendering unable to set the marker', () => {
    for (const candidate of [
      'lib/gmail/outbound/assignment-email.ts',
      'lib/gmail/outbound/reminder-email.ts',
      'lib/gmail/outbound/gmail-forward.ts',
    ]) {
      const code = readCode(path.join(webRoot, candidate));
      expect(
        code.includes('rocketGenerated'),
        `${candidate} sets the D136 marker. Only Owner Event Notifications carry it; a marked ` +
          'reminder or assignment email would be excluded from an ingestion path that should see it.',
      ).toBe(false);
    }
  });

  it('adds no threading or tracking header', () => {
    const code = readCode(MIME);
    for (const forbidden of ['In-Reply-To', 'References', 'threadId']) {
      expect(code.includes(forbidden)).toBe(false);
    }
  });
});

describe('A8.5c: ingestion excludes the marker and nothing broader', () => {
  it('excludes on the marker, not on SENT, self-addressing, or sender identity', () => {
    const code = readCode(SYNC_ENGINE);
    const skip = code.slice(
      code.indexOf('const normalized = normalizeGmailMessage(raw)'),
      code.indexOf('fixtures.push(toParsedFixture'),
    );
    expect(skip).toContain('isRocketGeneratedOwnerNotification(normalized.rocketGeneratedMarkers)');
    for (const broader of ['SENT', 'fromAddress', 'emailAddress', 'toAddresses']) {
      expect(
        skip.includes(broader),
        `The exclusion consults ${broader}. Sent mail, self-addressed mail, and mail from the ` +
          'connected address are all things an Owner might genuinely want noticed (D136).',
      ).toBe(false);
    }
  });

  it('skips before any excerpt or event can be created', () => {
    const code = readCode(SYNC_ENGINE);
    const skipIndex = code.indexOf('isRocketGeneratedOwnerNotification(normalized');
    const fixtureIndex = code.indexOf('fixtures.push(toParsedFixture');
    // The incremental page-loop call site. The earlier one belongs to the initial cursor seed, which
    // fetches no messages at all.
    const persistIndex = code.lastIndexOf('runtime.persistGmailHistoryPageTransaction(');
    expect(skipIndex).toBeGreaterThan(-1);
    expect(persistIndex).toBeGreaterThan(-1);
    expect(skipIndex).toBeLessThan(fixtureIndex);
    expect(skipIndex).toBeLessThan(persistIndex);
  });

  it('reads the marker from top-level headers only', () => {
    const code = readCode(NORMALIZE);
    expect(code).toMatch(
      /rocketGeneratedMarkers:\s*headerValues\(headers,\s*ROCKET_GENERATED_HEADER_NAME\)/,
    );
    // `headers` is `raw.payload?.headers`. A nested `message/rfc822` part carries its own header
    // block, and honouring those would let anyone claim the exclusion by attaching a forwarded copy.
    expect(code).toMatch(/const headers = raw\.payload\?\.headers/);
  });

  it('grants the exclusion only to exactly one exact marker', () => {
    const code = readCode(DOMAIN_GMAIL);
    const start = code.indexOf('export function isRocketGeneratedOwnerNotification');
    // Bounded to this function's body. Reading to end of file would sweep in `isGmailInboxEligible`,
    // whose label lookups legitimately use `includes`.
    const fn = code.slice(start, code.indexOf('\n}', start));
    expect(fn).toMatch(/headerValues\.length !== 1/);
    expect(fn).toContain('=== ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION');
    for (const loose of ['startsWith', 'includes(', 'endsWith', 'indexOf']) {
      expect(
        fn.includes(loose),
        `The marker comparison uses ${loose}. A substring match would hand the exclusion to any ` +
          'value that merely contains the token.',
      ).toBe(false);
    }
  });

  it('leaves the D068 label rules untouched', () => {
    const code = readCode(DOMAIN_GMAIL);
    const eligible = code.slice(code.indexOf('export function isGmailInboxEligible'));
    expect(eligible).toContain('GMAIL_INBOX_LABEL_ID');
    expect(eligible).toContain('GMAIL_EXCLUDED_LABEL_IDS');
    // The label gate knows nothing about the marker: the two exclusions are independent, and the
    // marker one lives in the sync engine where the header is available.
    expect(eligible.slice(0, eligible.indexOf('\n}'))).not.toContain('Rocket');
  });
});

describe('A8.5c: the A8.5b worker contract is unchanged', () => {
  it('keeps the Gmail call outside every database transaction', () => {
    for (const modulePath of [SERVICE, ADAPTER, PROVIDER]) {
      expect(
        readCode(modulePath).includes('$transaction'),
        `${path.relative(repoRoot, modulePath)} opens a transaction. A transaction held across a ` +
          'network call to Gmail holds row locks for as long as Gmail takes to answer.',
      ).toBe(false);
    }
  });

  it('still marks the provider call before the adapter is invoked', () => {
    const code = readCode(SERVICE);
    expect(code.indexOf('beginOwnerNotificationAttempt(')).toBeLessThan(
      code.indexOf('transport.send('),
    );
  });

  it('changes no claim, lease, retry, or staleness constant', () => {
    const code = readCode(path.join(webRoot, 'lib/notifications/process-config.ts'));
    expect(code).toContain('MAX_NOTIFICATIONS_PER_PROCESS = 25');
    expect(code).toContain('NOTIFICATION_CLAIM_LEASE_MS = 2 * 60_000');
    expect(code).toContain('MAX_NOTIFICATION_ATTEMPTS = 3');
    expect(code).toContain('NOTIFICATION_STALENESS_HORIZON_MS = 24 * 60 * 60_000');
    expect(code).toContain('NOTIFICATION_PROCESS_STOP_MARGIN_MS = 15_000');
  });

  it('leaves the reminder engine untouched', () => {
    const reminderRoute = readCode(
      path.join(webRoot, 'app/api/v1/internal/reminders/process/route.ts'),
    );
    expect(reminderRoute).not.toContain('otification');

    const reminderTransport = readCode(
      path.join(webRoot, 'lib/gmail/outbound/reminder-transport.ts'),
    );
    expect(reminderTransport).not.toContain('otification');
    expect(reminderTransport).not.toContain('rocketGenerated');
  });

  it('adds no Owner-facing notification history surface', () => {
    const code = readCode(ROUTE);
    expect(code).toMatch(/export async function POST/);
    expect(code).not.toMatch(/export async function GET/);
  });
});
