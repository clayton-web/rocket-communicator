import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.6a structural guards for the Owner Attention surface (D103, D108, D112).
 *
 * Two of these guard against mistakes that would look right in review and be wrong in production:
 * reading the wrong reminder field, and treating the reminder ETag as a freshness signal. Neither
 * would fail a test, break a type, or render oddly — the page would simply tell an Owner something
 * false — so the only thing that can catch them on every run is a read of the source.
 *
 * The rest hold the slice's boundary. A8.6a is a read, and read-only is a property that erodes one
 * convenient mutation at a time.
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
const LIST = path.join(ATTENTION_DIR, '_components/attention-list.tsx');
const LOADING = path.join(ATTENTION_DIR, 'loading.tsx');
const ERROR_BOUNDARY = path.join(ATTENTION_DIR, 'error.tsx');
const PROJECTION = path.join(webRoot, 'lib/reminders/attention.ts');
const SERVICE = path.join(webRoot, 'lib/reminders/attention-service.ts');
const REPOSITORY = path.join(
  repoRoot,
  'packages/db/src/repositories/reminder-schedule-repository.ts',
);

/** Every file the Attention surface is made of. */
const ATTENTION_SOURCES = [PAGE, LIST, LOADING, ERROR_BOUNDARY, PROJECTION, SERVICE] as const;

function attentionCode(): string {
  return ATTENTION_SOURCES.map(readCode).join('\n');
}

/** The one repository function this surface added, isolated from the rest of the file. */
function attentionRepositoryFunction(): string {
  const source = readCode(REPOSITORY);
  const start = source.indexOf(
    'export async function listReminderSchedulesRequiringOwnerAttention',
  );
  expect(start).toBeGreaterThan(-1);
  const rest = source.slice(start);
  const end = rest.indexOf('\nexport ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('A8.6a Attention surface guards', () => {
  describe('the two reminder traps', () => {
    /**
     * `Task.reminder` is the A2-era `ReminderMetadata` blob — `nextReminderAt`, `paused`,
     * `pausedReason` — and it is not the A8 Reminder Schedule. It survives on every Task row, reads
     * plausibly, and is stale: nothing in A8 maintains it. A surface that displayed its
     * `nextReminderAt` would tell an Owner when the next reminder is due using a field no scheduler
     * has written to since A2.
     */
    it('never reads the legacy Task.reminder metadata', () => {
      const code = attentionCode();
      for (const legacy of ['nextReminderAt', 'pausedReason', 'reminderPaused']) {
        expect(code).not.toContain(legacy);
      }
      // `.reminder` as a Task property access, distinct from the `lib/reminders` module path.
      expect(code).not.toMatch(/\btask\.reminder\b/i);
    });

    /**
     * The reminder ETag deliberately does not move when a worker records a delivery, increments the
     * overdue count, or raises the attention flag: it exists so an Owner's in-flight due-date edit
     * cannot be invalidated by a background send. That makes it precisely wrong as a freshness
     * signal here — an attention item can appear while the ETag is unchanged.
     */
    it('never uses the reminder ETag for reading, caching, or freshness', () => {
      const code = attentionCode();
      for (const token of ['reminderETag', 'etag', 'ETag', 'If-None-Match', 'revalidate']) {
        expect(code).not.toContain(token);
      }
    });
  });

  describe('internal vocabulary stays out of the surface', () => {
    it('references no worker-coordination or row-identity field', () => {
      const code = attentionCode();
      for (const internal of [
        'claimedBy',
        'claimedAt',
        'claimExpiresAt',
        'reminderVersion',
        'generation',
        'establishedAt',
        'suspendedAt',
      ]) {
        expect(code).not.toContain(internal);
      }
    });

    it('selects none of those fields in the repository read either', () => {
      const fn = attentionRepositoryFunction();
      for (const internal of ['claimedBy', 'claimExpiresAt', 'reminderVersion', 'generation:']) {
        expect(fn).not.toContain(internal);
      }
    });
  });

  describe('what the surface must not reach', () => {
    it('touches no Owner notification persistence', () => {
      const code = attentionCode();
      for (const forbidden of [
        'ownerNotificationIntent',
        'ownerNotificationAttempt',
        'OwnerNotificationIntent',
        'OwnerNotificationAttempt',
        'lib/notifications',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it('imports no Gmail module', () => {
      const code = attentionCode();
      expect(code).not.toMatch(/from\s+['"][^'"]*gmail[^'"]*['"]/i);
      expect(code).not.toContain('GmailApiClient');
    });

    it('reads no feature flag', () => {
      const code = attentionCode();
      for (const flag of [
        'ENABLE_OWNER_EVENT_CAPTURE',
        'ENABLE_OWNER_EVENT_DELIVERY',
        'ENABLE_REMINDER_DELIVERY',
      ]) {
        expect(code).not.toContain(flag);
      }
      expect(code).not.toContain('process.env');
    });
  });

  describe('read-only', () => {
    it('declares no server action and submits no form', () => {
      const code = attentionCode();
      expect(code).not.toContain("'use server'");
      expect(code).not.toContain('"use server"');
      expect(code).not.toMatch(/<form\b/);
    });

    it('issues no write through the database or the API client', () => {
      const code = attentionCode();
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
     * The only interactive control on the surface is the error boundary's Retry, which re-renders
     * the segment. Every other control would be an A8.6b repair action arriving early.
     */
    it('renders no button outside the error boundary', () => {
      for (const source of [PAGE, LIST, LOADING, PROJECTION, SERVICE]) {
        expect(readCode(source)).not.toMatch(/<button\b/);
      }
      expect(readCode(ERROR_BOUNDARY)).toMatch(/<button\b/);
    });

    it('adds no API route for attention', () => {
      const apiRoot = path.join(webRoot, 'app/api');
      const found: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (statSync(full).isDirectory()) {
            walk(full);
          } else if (/attention/i.test(full)) {
            found.push(full);
          }
        }
      };
      walk(apiRoot);
      expect(found).toEqual([]);
    });
  });

  describe('the query shape', () => {
    /**
     * The N+1 guard as a structural fact rather than a measurement. The counting test in
     * `packages/db` proves the number is flat; this proves there is no place for it to grow — one
     * `findMany`, and no awaited database call anywhere near an iteration over its result.
     */
    it('issues exactly one database call, outside any loop', () => {
      const fn = attentionRepositoryFunction();
      expect(fn.match(/await db\./g) ?? []).toHaveLength(1);
      expect(fn).toContain('findMany');

      for (const loop of ['for (', 'forEach(', 'Promise.all', '.map(async', 'while (']) {
        // `.map(` alone is permitted: mapping rows to a return shape reads nothing.
        expect(fn).not.toContain(loop);
      }
    });

    it('resolves Tasks through a nested relation select rather than a second lookup', () => {
      const fn = attentionRepositoryFunction();
      expect(fn).toContain('task: { select:');
      expect(fn).not.toContain('db.task.find');
    });

    /**
     * Application-level organization filtering, on both the schedule and its Task.
     *
     * Deny-by-default RLS with no policies is not tenant isolation for a Prisma read whose
     * connection role owns the tables, so the `where` clause is the isolation. The relation filter
     * is the second half: without it a schedule could name a Task in another organization and the
     * page would render the link.
     */
    it('filters both the schedule and its Task by organization', () => {
      const fn = attentionRepositoryFunction();
      expect(fn).toMatch(/organizationId:\s*input\.organizationId/);
      expect(fn).toMatch(/task:\s*\{\s*organizationId:\s*input\.organizationId\s*\}/);
    });

    it('is bounded by a validated limit and ordered totally', () => {
      const fn = attentionRepositoryFunction();
      expect(fn).toMatch(/Number\.isInteger\(input\.limit\)/);
      expect(fn).toContain('persistenceValidation');
      expect(fn).toContain('take: input.limit');
      expect(fn).toMatch(/orderBy:\s*\[.*taskId:\s*'asc'/s);
    });

    /** D103: the database package reads no clock. This read needs no instant at all. */
    it('reads no clock', () => {
      const fn = attentionRepositoryFunction();
      for (const clock of ['Date.now', 'new Date()', 'fromIso']) {
        expect(fn).not.toContain(clock);
      }
    });
  });

  describe('the page shape', () => {
    it('authenticates before reading', () => {
      const page = readCode(PAGE);
      expect(page.indexOf('requireOwnerPage')).toBeLessThan(page.indexOf('loadOwnerAttentionView'));
    });

    it('takes the organization from the session, never from input', () => {
      const page = readCode(PAGE);
      expect(page).toContain('authenticated.actor.organizationId');
      expect(page).not.toContain('searchParams');
      expect(page).not.toContain('params');
    });

    it('does not cache, and does not swallow a database failure', () => {
      const page = readCode(PAGE);
      expect(page).toContain("dynamic = 'force-dynamic'");
      expect(page).not.toContain('unstable_cache');
      expect(page).not.toContain('revalidate');
      // The only catch re-throws; nothing degrades a failure into an empty list.
      expect(page).not.toMatch(/catch[\s\S]*items:\s*\[\]/);
      expect(page).not.toMatch(/catch[\s\S]*batchFilled/);
    });
  });

  describe('nothing operational changed', () => {
    it('leaves vercel.json without a cron', () => {
      const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
        crons?: unknown[];
      };
      expect(vercel.crons).toBeUndefined();
    });
  });
});
