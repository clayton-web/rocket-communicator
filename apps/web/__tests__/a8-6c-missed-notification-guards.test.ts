import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.6c structural guards for `/attention` section two (D103, D132–D135).
 *
 * Three classes of mistake here would pass review, pass every behavioural test, and be wrong in
 * production. A runtime value imported from an externalized package resolves to `undefined` in the
 * built server and nowhere else — A8.6b lost a day to exactly that, and the ETag it produced said
 * `vundefined`. A `findOwnerNotificationSubjectTaskId` call slipped into a loop is a query per row
 * that no unit test would notice. And a control that implies Rocket will try again is a promise
 * the system has no policy to keep. Only a read of the source catches any of them on every run.
 *
 * The rest hold the slice's boundary. A8.6c is a read of durable state, and read-only is a
 * property that erodes one convenient mutation at a time.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.join(repoRoot, 'apps/web');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

const ATTENTION_DIR = path.join(webRoot, 'app/(owner)/attention');
const PAGE = path.join(ATTENTION_DIR, 'page.tsx');
const SECTION = path.join(ATTENTION_DIR, '_components/missed-notification-list.tsx');
const PROJECTION = path.join(webRoot, 'lib/notifications/missed-notifications.ts');
const SERVICE = path.join(webRoot, 'lib/notifications/missed-notifications-service.ts');
const ACTOR_LABELS = path.join(webRoot, 'lib/presentation/actor-label.ts');
const REPOSITORY = path.join(
  repoRoot,
  'packages/db/src/repositories/owner-notification-repository.ts',
);

/** Every file A8.6c added or changed on the read path. */
const A86C_SOURCES = [PAGE, SECTION, PROJECTION, SERVICE, ACTOR_LABELS] as const;

/**
 * The section's own files, without the page.
 *
 * The page is a composition point and carries request-context plumbing — a request id, a
 * correlation id — that has nothing to do with a notification's correlation columns. Guards about
 * what the *projection* may expose therefore run against the files that project.
 */
const SECTION_SOURCES = [SECTION, PROJECTION, SERVICE, ACTOR_LABELS] as const;

function a86cCode(): string {
  return A86C_SOURCES.map(readCode).join('\n');
}

function sectionCode(): string {
  return SECTION_SOURCES.map(readCode).join('\n');
}

/**
 * Every `await db.` that sits inside a loop body, by brace depth.
 *
 * A textual count of database calls cannot catch an N+1: one `await db.` inside a `for` is still
 * one occurrence in the source and a statement per row at runtime. Tracking whether the line is
 * enclosed by a loop is what actually distinguishes the two.
 */
function databaseCallsInsideLoops(source: string): string[] {
  const found: string[] = [];
  const loopDepths: number[] = [];
  let depth = 0;

  for (const line of source.split('\n')) {
    if (loopDepths.length > 0 && /await\s+db\./.test(line)) {
      found.push(line.trim());
    }
    const isLoopHeader = /^\s*(for|while)\s*\(/.test(line) || /\.forEach\(/.test(line);
    if (isLoopHeader) {
      loopDepths.push(depth);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    while (loopDepths.length > 0 && depth <= loopDepths[loopDepths.length - 1]!) {
      loopDepths.pop();
    }
  }
  return found;
}

/** One exported function from the notification repository, isolated from the rest of the file. */
function repositoryFunction(name: string): string {
  const source = readCode(REPOSITORY);
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf('\nexport ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('A8.6c undelivered notification surface guards', () => {
  describe('the runtime-import hazard', () => {
    /**
     * `@aicaa/db` is in `serverExternalPackages`, so a value imported from it statically is not
     * the value the built server sees. A8.6b shipped an ETag reading `vundefined` for exactly this
     * reason. Types are erased at compile time and are safe; anything else must come through
     * `loadDbRuntime()`.
     */
    it('imports only types from the externalized database package', () => {
      for (const source of A86C_SOURCES) {
        const code = readCode(source);
        // `[^;]*` keeps the match inside one statement, so a preceding import cannot absorb it.
        expect(code).not.toMatch(/import\s+(?!type\b)[^;]*from\s+['"]@aicaa\/db['"]/);
        expect(code).not.toMatch(/import\s+['"]@aicaa\/db['"]/);
        expect(code).not.toMatch(/require\(\s*['"]@aicaa\/db['"]/);
      }
    });

    it('reaches the repository through the traced runtime loader and nothing else', () => {
      const service = readCode(SERVICE);
      expect(service).toContain('loadDbRuntime');
      expect(service).toContain('listUndeliveredOwnerNotifications');
      // No direct client construction, and no import of the built runtime bundle by path.
      expect(service).not.toContain('createPrismaClient');
      expect(service).not.toContain('packages/db/dist');
    });

    it('registers the read in the runtime contract, so a missing export fails at load', () => {
      const runtimeDb = readCode(path.join(webRoot, 'lib/db/runtime-db.ts'));
      expect(runtimeDb).toContain("'listUndeliveredOwnerNotifications'");
      const entry = readCode(path.join(webRoot, 'lib/db/db-runtime-entry.ts'));
      expect(entry).toContain('listUndeliveredOwnerNotifications');
      const reexports = readCode(path.join(webRoot, 'lib/db/db-runtime-reexports.ts'));
      expect(reexports).toContain('listUndeliveredOwnerNotifications');
    });
  });

  describe('read-only', () => {
    it('declares no server action and submits no form', () => {
      const code = a86cCode();
      expect(code).not.toContain("'use server'");
      expect(code).not.toContain('"use server"');
      expect(code).not.toMatch(/<form\b/);
      expect(code).not.toMatch(/<input\b/);
    });

    it('issues no write through the database or the API client', () => {
      const code = a86cCode();
      for (const mutation of [
        '.create(',
        '.update(',
        '.updateMany(',
        '.delete(',
        '.deleteMany(',
        '.upsert(',
        '$transaction',
        "method: 'POST'",
        "method: 'PUT'",
        "method: 'DELETE'",
      ]) {
        expect(code).not.toContain(mutation);
      }
    });

    /**
     * The four controls this surface must never grow.
     *
     * Resend has no ratified policy and would re-enter the delivery state machine from a page.
     * Acknowledgement and dismissal would each require persisting a fact about the Owner's
     * attention that no decision defines — and the ratified retirement rule is the thirty-day
     * window and nothing else.
     */
    it('offers no resend, acknowledgement, dismissal, or read state', () => {
      const code = a86cCode().toLowerCase();
      for (const forbidden of [
        'resend',
        'markasread',
        'mark_as_read',
        'acknowledge',
        'acknowledgement',
        'dismiss',
        'snooze',
        'archive',
        'unread',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it('renders no button on the section', () => {
      expect(readCode(SECTION)).not.toMatch(/<button\b/);
    });

    /**
     * A8.6c adds no endpoint. The page runs on the server and reads the repository directly, like
     * every other Owner surface; an API route would exist only to be called by the page that could
     * have done the read itself.
     *
     * The A8.5b internal processing route is the one notification endpoint that may exist. Naming
     * it here rather than excluding the word means a second endpoint fails this test.
     */
    it('adds no API route for notifications beyond the A8.5b internal processor', () => {
      const apiRoot = path.join(webRoot, 'app/api');
      const found: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walk(full);
          } else if (/notification/i.test(full)) {
            found.push(path.relative(webRoot, full));
          }
        }
      };
      walk(apiRoot);
      expect(found).toEqual(['app/api/v1/internal/notifications/process/route.ts']);
    });
  });

  describe('one read per navigation', () => {
    /** Nothing here refreshes itself, and nothing caches an answer that can go stale. */
    it('polls nothing and caches nothing', () => {
      const code = a86cCode();
      for (const forbidden of [
        'setInterval',
        'setTimeout',
        'useEffect',
        'useState',
        'revalidate',
        'unstable_cache',
        'refetch',
        'router.refresh',
      ]) {
        expect(code).not.toContain(forbidden);
      }
      expect(readCode(PAGE)).toContain("dynamic = 'force-dynamic'");
    });

    it('is a server surface with no client component among its parts', () => {
      const code = a86cCode();
      expect(code).not.toContain("'use client'");
      expect(code).not.toContain('"use client"');
    });
  });

  describe('what the surface must not reach', () => {
    it('imports no Gmail module and names no transport', () => {
      const code = a86cCode();
      expect(code).not.toMatch(/from\s+['"][^'"]*gmail[^'"]*['"]/i);
      expect(code).not.toContain('GmailApiClient');
      expect(code).not.toContain('sendRawMessage');
      expect(code).not.toContain('buildOwnerNotificationEmail');
    });

    it('reads no feature flag', () => {
      const code = a86cCode();
      for (const flag of [
        'ENABLE_OWNER_EVENT_CAPTURE',
        'ENABLE_OWNER_EVENT_DELIVERY',
        'ENABLE_REMINDER_DELIVERY',
      ]) {
        expect(code).not.toContain(flag);
      }
      expect(code).not.toContain('process.env');
    });

    /**
     * Attempt history is out of scope. The Owner needs to know the message did not arrive, not how
     * many times a worker called a provider, and an attempt row carries provider references that
     * have no place on an Owner surface.
     */
    it('reads no delivery attempt history', () => {
      const code = a86cCode();
      for (const forbidden of [
        'ownerNotificationAttempt',
        'OwnerNotificationAttempt',
        'listOwnerNotificationAttempts',
        'attemptNumber',
        'attemptCount',
        'providerMessageRef',
        'providerAcceptedAt',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    /**
     * `attributionLabel` is a write-path display string and is the field most likely to carry a
     * Recipient's name. Scoped to these files on purpose: Task detail renders it legitimately for
     * note attribution, and a repository-wide ban would fail against working code.
     */
    it('never renders the intent’s attribution label, and resolves no Recipient identity', () => {
      const code = a86cCode();
      for (const forbidden of [
        'attributionLabel',
        'intendedRecipientEmail',
        'emailNormalized',
        'displayName',
        'recipientId',
        'capabilityUrl',
        'tokenHash',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it('exposes no worker-coordination or correlation vocabulary', () => {
      const code = sectionCode();
      for (const internal of [
        'occurrenceKey',
        'claimedBy',
        'claimExpiresAt',
        'claimSequence',
        'failureCode',
        'requestId',
        'correlationId',
        'auditEventId',
      ]) {
        expect(code).not.toContain(internal);
      }
    });
  });

  describe('the actor mapping', () => {
    /** One closed mapping, three categories, and no fourth branch invented at a call site. */
    it('is a single closed record with the ratified labels', () => {
      const code = readCode(ACTOR_LABELS);
      expect(code).toMatch(/owner:\s*'You'/);
      expect(code).toMatch(/capability:\s*'The Recipient'/);
      expect(code).toMatch(/system:\s*'Rocket'/);
      expect(code).toContain('Record<OwnerFacingActorKind, string>');
    });

    /** Deliberately diverges from the A8.5 email renderer. Neither imports the other. */
    it('does not reuse the email renderer’s wording or module', () => {
      const code = readCode(ACTOR_LABELS) + readCode(PROJECTION);
      expect(code).not.toContain('your assistant');
      expect(code).not.toContain('owner-notification-email');
    });

    it('is the only place the section decides an actor name', () => {
      const code = readCode(PROJECTION) + readCode(SECTION);
      expect(readCode(PROJECTION)).toContain('ownerFacingActorLabel');
      expect(code).not.toMatch(/'The Recipient'/);
      expect(code).not.toMatch(/actorKind\s*===/);
    });
  });

  describe('the repository query', () => {
    const read = () => repositoryFunction('listUndeliveredOwnerNotifications');
    const resolver = () => repositoryFunction('resolveSubjectTaskIds');

    it('is bounded by a validated limit no caller can widen past fifty', () => {
      const fn = read();
      expect(fn).toMatch(/Number\.isInteger\(input\.limit\)/);
      expect(fn).toMatch(/input\.limit\s*>\s*50/);
      expect(fn).toContain('persistenceValidation');
      expect(fn).toContain('take: input.limit');
    });

    it('is ordered totally, most recent first', () => {
      const fn = read();
      expect(fn).toMatch(/orderBy:\s*\[\{\s*occurredAt:\s*'desc'\s*\},\s*\{\s*id:\s*'desc'\s*\}\]/);
    });

    it('requires the window cutoff rather than treating it as optional', () => {
      const fn = read();
      expect(fn).toContain('occurredAt: { gte: cutoff }');
      expect(fn).toMatch(/ISO-8601 window cutoff/);
    });

    /** D103: the database package reads no clock. The cutoff arrives as an argument. */
    it('reads no clock', () => {
      const fn = read();
      for (const clock of ['Date.now', 'new Date()']) {
        expect(fn).not.toContain(clock);
      }
    });

    it('shows only the four undelivered states and excludes the three reminder stops', () => {
      const fn = read();
      expect(fn).toContain('state: { in: [...UNDELIVERED_NOTIFICATION_STATES] }');
      expect(fn).toContain('eventType: { notIn: [...REMINDER_STOP_EVENT_TYPES] }');

      const file = readCode(REPOSITORY);
      for (const state of [
        'suppressed',
        'failed_permanent',
        'ambiguous',
        'requires_owner_attention',
      ]) {
        expect(file).toMatch(new RegExp(`UNDELIVERED_NOTIFICATION_STATES[\\s\\S]{0,200}${state}`));
      }
      for (const eventType of [
        'reminder_schedule_stopped_ceiling_reached',
        'reminder_schedule_stopped_permanent_failure',
        'reminder_schedule_stopped_repeated_ambiguous',
      ]) {
        expect(file).toMatch(new RegExp(`REMINDER_STOP_EVENT_TYPES[\\s\\S]{0,300}${eventType}`));
      }
      // `reminder.no_active_assignment` has no other surface and must stay visible.
      expect(file).not.toMatch(
        /REMINDER_STOP_EVENT_TYPES[\s\S]{0,300}reminder_no_active_assignment/,
      );
    });

    /**
     * The N+1 as a structural fact rather than a measurement. The counting test in `packages/db`
     * proves the number is flat; this proves there is nowhere for it to grow — no awaited database
     * call inside an iteration, in either half of the read.
     */
    it('issues no database call inside a loop', () => {
      for (const fn of [read(), resolver()]) {
        for (const loop of ['.map(async', 'for await', 'Promise.all']) {
          expect(fn).not.toContain(loop);
        }
        expect(databaseCallsInsideLoops(fn)).toEqual([]);
      }
      // And the single-subject resolver, which is the obvious wrong tool, is never called here.
      expect(read() + resolver()).not.toContain('findOwnerNotificationSubjectTaskId(');
    });

    /**
     * Tenant isolation is the `where` clause. Deny-by-default RLS with no policies is not
     * isolation for a Prisma read whose connection role owns the tables, so every statement —
     * including each subject lookup and the Task load — has to carry the organization itself.
     */
    it('filters the intents, every subject lookup, and the Task load by organization', () => {
      expect(read()).toMatch(/organizationId:\s*input\.organizationId/);
      expect(read()).toMatch(
        /in:\s*candidateTaskIds\s*\},\s*organizationId:\s*input\.organizationId/,
      );

      const fn = resolver();
      const lookups = fn.match(/findMany\(\{[\s\S]*?\}\)/g) ?? [];
      expect(lookups.length).toBeGreaterThanOrEqual(3);
      for (const lookup of lookups) {
        expect(lookup).toContain('organizationId');
      }
    });

    /** Absent rather than filtered later: the projected columns are the whole `select`. */
    it('selects no worker-coordination, provider, or correlation column', () => {
      const fn = read();
      for (const internal of [
        'occurrenceKey: true',
        'claimedBy: true',
        'claimExpiresAt: true',
        'claimSequence: true',
        'attemptCount: true',
        'failureCode: true',
        'requestId: true',
        'correlationId: true',
        'auditEventId: true',
        'attributionLabel: true',
      ]) {
        expect(fn).not.toContain(internal);
      }
    });
  });

  describe('nothing operational changed', () => {
    it('leaves vercel.json without a cron', () => {
      const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
        crons?: unknown[];
      };
      expect(vercel.crons).toBeUndefined();
    });

    /** A8.6c reads durable state. It enables nothing, and the flags stay off by absence. */
    it('adds no default value for any A8.5 or A8.4 delivery flag', () => {
      const example = readFileSync(path.join(webRoot, '.env.example'), 'utf8');
      for (const flag of [
        'ENABLE_OWNER_EVENT_CAPTURE',
        'ENABLE_OWNER_EVENT_DELIVERY',
        'ENABLE_REMINDER_DELIVERY',
      ]) {
        expect(example).not.toMatch(new RegExp(`^\\s*${flag}\\s*=\\s*(true|1)`, 'mi'));
      }
    });

    it('adds no migration', () => {
      const migrations = readdirSync(path.join(repoRoot, 'packages/db/prisma/migrations')).filter(
        (entry) => /a8_6/i.test(entry),
      );
      expect(migrations).toEqual([]);
    });
  });
});
