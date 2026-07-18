import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const vercelJsonPath = path.join(repoRoot, 'vercel.json');
const pollRoutePath = path.join(repoRoot, 'apps/web/app/api/v1/internal/gmail/poll/route.ts');

/** Vercel Hobby rejects cron schedules more frequent than once per day. */
function isMoreFrequentThanDaily(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) {
    return true;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const wild = (value: string) => value === '*';
  const step = (value: string) => value.includes('/');
  // Any minute/hour stepping or non-wildcard minute/hour with wild day fields is sub-daily.
  if (step(minute) || step(hour)) {
    return true;
  }
  if (!wild(minute) && wild(hour) && wild(dayOfMonth) && wild(month) && wild(dayOfWeek)) {
    return true;
  }
  if (wild(minute) && !wild(hour) && wild(dayOfMonth) && wild(month) && wild(dayOfWeek)) {
    // e.g. `0 12 * * *` is daily — allowed
    return false;
  }
  if (!wild(minute) && !wild(hour) && wild(dayOfMonth) && wild(month) && wild(dayOfWeek)) {
    // e.g. `30 9 * * *` daily — allowed
    return false;
  }
  // Conservative: reject anything that is not a clear once-per-day pattern.
  return !(
    !wild(hour) &&
    wild(dayOfMonth) &&
    wild(month) &&
    wild(dayOfWeek) &&
    !step(minute) &&
    !step(hour)
  );
}

describe('vercel Hobby cron configuration', () => {
  it('parses root vercel.json as JSON', () => {
    expect(existsSync(vercelJsonPath)).toBe(true);
    const raw = readFileSync(vercelJsonPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('does not declare unsupported sub-daily Vercel Hobby crons', () => {
    const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    const crons = config.crons ?? [];
    for (const cron of crons) {
      expect(cron.schedule).toBeTruthy();
      expect(isMoreFrequentThanDaily(cron.schedule!)).toBe(false);
      if (cron.path === '/api/v1/internal/gmail/poll') {
        // Five-minute polling must use an External Scheduler, not Vercel Hobby cron.
        expect(isMoreFrequentThanDaily(cron.schedule!)).toBe(false);
      }
    }
    expect(
      crons.some(
        (cron) => cron.path === '/api/v1/internal/gmail/poll' && cron.schedule === '*/5 * * * *',
      ),
    ).toBe(false);
  });

  it('keeps the internal Gmail poll route present for External Scheduler invocation', () => {
    expect(existsSync(pollRoutePath)).toBe(true);
    const source = readFileSync(pollRoutePath, 'utf8');
    expect(source).toMatch(/export const GET/);
    expect(source).toMatch(/export const POST/);
    expect(source).toMatch(/authorizeCronRequest/);
    expect(source).toMatch(/CRON_SECRET/);
  });

  it('keeps the internal suggestion process route present and separate from Gmail poll', () => {
    const processRoutePath = path.join(
      repoRoot,
      'apps/web/app/api/v1/internal/suggestions/process/route.ts',
    );
    expect(existsSync(processRoutePath)).toBe(true);
    const source = readFileSync(processRoutePath, 'utf8');
    expect(source).toMatch(/export async function POST/);
    expect(source).toMatch(/authorizeCronRequest/);
    expect(source).not.toMatch(/runInternalGmailPoll/);

    const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(
      (config.crons ?? []).some((cron) => cron.path === '/api/v1/internal/suggestions/process'),
    ).toBe(false);
  });
});
