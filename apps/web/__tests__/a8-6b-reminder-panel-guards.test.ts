import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A8.6b structural guards for the Task-level reminder panel (D102, D104, D108, D129, D132).
 *
 * These catch mistakes that would pass review, pass types, and render convincingly — and be wrong.
 *
 * The sharpest is the legacy reminder model. `Task.reminder` is A2-era metadata with a
 * `nextReminderAt` and a `pausedReason` that read exactly like the A8 fields a panel wants, and a
 * panel sourced from it would show a plausible next reminder date that no worker will ever act on.
 * Nothing about that fails: the types are real, the values are real, and only the meaning is wrong.
 *
 * The rest hold boundaries that erode one convenient change at a time — a resend button that seems
 * harmless, a silent retry that seems helpful, a poll that seems fresher.
 */

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webRoot = path.join(repoRoot, 'apps/web');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(absolutePath: string): string {
  return stripComments(readFileSync(absolutePath, 'utf8'));
}

const PANEL = path.join(webRoot, 'app/(owner)/tasks/_components/reminder-panel.tsx');
const DIALOG = path.join(webRoot, 'app/(owner)/tasks/_components/reminder-removal-dialog.tsx');
const HOOK = path.join(webRoot, 'lib/reminders/client/use-task-reminder.ts');
const ERRORS = path.join(webRoot, 'lib/reminders/client/public-errors.ts');
const PRESENTATION = path.join(webRoot, 'lib/reminders/presentation.ts');
const DUE_DATE = path.join(webRoot, 'lib/reminders/due-date.ts');
const STOP_COPY = path.join(webRoot, 'lib/reminders/stop-reason-copy.ts');
const TASK_DETAIL = path.join(webRoot, 'app/(owner)/tasks/_components/task-detail.tsx');
const TASK_PAGE = path.join(webRoot, 'app/(owner)/tasks/[taskId]/page.tsx');
const API_CLIENT = path.join(webRoot, 'lib/owner/api-client.ts');

/** Every file A8.6b added or changed to build the panel. */
const PANEL_SOURCES = [PANEL, DIALOG, HOOK, ERRORS, PRESENTATION, DUE_DATE, STOP_COPY] as const;

function panelCode(): string {
  return PANEL_SOURCES.map(readCode).join('\n');
}

/** The reminder functions added to the shared Owner client, isolated from the handoff ones. */
function reminderClientFunctions(): string {
  const source = readCode(API_CLIENT);
  return ['fetchTaskReminder', 'putTaskReminder', 'deleteTaskReminder']
    .map((name) => {
      const start = source.indexOf(`export async function ${name}`);
      expect(start, `${name} is missing from the Owner API client`).toBeGreaterThan(-1);
      const rest = source.slice(start);
      const end = rest.indexOf('\nexport ', 1);
      return end === -1 ? rest : rest.slice(0, end);
    })
    .join('\n');
}

describe('A8.6b guards: legacy reminder model', () => {
  /*
   * The trap. A2's `Task.reminder` carries fields whose names describe exactly what this panel
   * displays, and the compiler is happy to read them.
   */
  it('reads no field of the A2-era Task.reminder metadata', () => {
    const code = panelCode();

    for (const field of ['nextReminderAt', 'pausedReason', 'reminderStage', 'waitingPaused']) {
      expect(code, `${field} belongs to the legacy reminder model`).not.toContain(field);
    }
  });

  it('never reaches through a Task to a reminder property', () => {
    const code = panelCode();

    expect(code).not.toMatch(/task\s*\.\s*reminder\b/i);
    expect(code).not.toMatch(/\breminder\s*\?\.\s*(paused|nextReminderAt)/i);
  });

  it('sources every reminder fact from the A8 TaskReminderState', () => {
    expect(readCode(PRESENTATION)).toContain("components['schemas']['TaskReminderState']");
    expect(readCode(PANEL)).toContain("components['schemas']['TaskReminderState']");
    expect(readCode(HOOK)).toContain("components['schemas']['TaskReminderState']");
  });

  it('passes the panel A8 reminder state rather than the Task’s legacy reminder field', () => {
    const detail = readCode(TASK_DETAIL);

    expect(detail).toContain('initialReminder={initialReminder}');
    expect(detail).not.toMatch(/initialReminder=\{task\.reminder\}/);
  });
});

describe('A8.6b guards: ETag discipline', () => {
  it('sends an If-Match on both reminder mutations', () => {
    const client = reminderClientFunctions();

    expect(client.match(/'If-Match'/g)?.length).toBe(2);
  });

  /*
   * A Task ETag would be accepted by every type in the path and refused by the route with a `412`,
   * which reads as a concurrency conflict rather than the wiring mistake it is.
   */
  it('never substitutes the Task ETag for the reminder ETag', () => {
    const code = `${panelCode()}\n${reminderClientFunctions()}`;

    expect(code).not.toMatch(/ifMatch:\s*task\.etag/);
    expect(code).not.toMatch(/ifMatch:\s*initialTask\.etag/);
    expect(readCode(HOOK)).toMatch(/ifMatch:\s*previousEtag/);
  });

  it('takes the reminder token from reminder state, not from the Task', () => {
    const hook = readCode(HOOK);

    expect(hook).toContain('state.etag');
    expect(hook).not.toMatch(/task\.etag/);
  });

  /*
   * The A8.6a trap, still live here. The reminder ETag guards configuration writes; it says nothing
   * about worker activity, so using it to decide whether displayed counts are current would report
   * stale delivery data as fresh.
   */
  it('does not treat the ETag as a freshness signal', () => {
    const code = panelCode().toLowerCase();

    expect(code).not.toMatch(/etag[^\n]*\b(fresh|stale data|up to date|current as of)\b/);
    expect(code).not.toMatch(/\b(fresh|freshness)\b[^\n]*etag/);
  });
});

describe('A8.6b guards: prohibited controls and behaviours', () => {
  /*
   * No resend in any spelling. D129 stops after repeated ambiguity precisely because retrying an
   * unconfirmed delivery may send a third copy of something that already arrived twice, and no
   * resend policy has been ratified.
   */
  it('offers no resend, send-now, or force control', () => {
    const code = panelCode().toLowerCase();

    for (const phrase of [
      'resend',
      'send now',
      'send again',
      'sendreminder',
      'force next',
      'forcereminder',
      'retry reminder',
      'reset ambiguity',
      'restart reminders',
    ]) {
      expect(code, `"${phrase}" appears in the reminder panel`).not.toContain(phrase);
    }
  });

  /*
   * A silent retry after a refused precondition would repeat a due-date change the Owner never
   * reconfirmed, which for D104 means opening a reminder cycle they did not ask for.
   */
  it('resolves refusals by re-reading, and never by resubmitting', () => {
    const hook = readCode(HOOK);

    expect(hook).toContain('reread');
    // The mutation functions are called exactly once each, from their own handler.
    expect(hook.match(/putTaskReminder\(/g)?.length).toBe(1);
    expect(hook.match(/deleteTaskReminder\(/g)?.length).toBe(1);
    expect(hook).not.toMatch(/\bretry\b/i);
  });

  it('does not poll, auto-refresh, or schedule background work', () => {
    const code = panelCode();

    for (const pattern of [
      /setInterval\(/,
      /setTimeout\(/,
      /requestIdleCallback\(/,
      /router\.refresh\(/,
    ]) {
      expect(code, `${pattern} would make the panel refresh itself`).not.toMatch(pattern);
    }
  });

  it('keeps no local authoritative state, queue, or offline cache', () => {
    const code = panelCode();

    for (const api of [
      'sessionStorage',
      'localStorage',
      'serviceWorker',
      'navigator.onLine',
      'BackgroundSync',
      'caches.',
    ]) {
      expect(code, `${api} would let the browser hold reminder truth`).not.toContain(api);
    }
  });

  it('adopts reminder state only from a server response', () => {
    const hook = readCode(HOOK);

    // Every adoption goes through one function, and every call site passes a server response body.
    const adoptions = hook.match(/adopt\([^)]*\)/g) ?? [];
    expect(adoptions.length).toBeGreaterThan(0);
    for (const call of adoptions) {
      expect(call, 'reminder state was adopted from something other than a response').toBe(
        'adopt(result.data)',
      );
    }
    // No hand-built state object anywhere.
    expect(hook).not.toMatch(/setState\(\s*\{/);
    expect(hook).not.toMatch(/dueLocalDate:\s*dueLocalDate/);
  });
});

describe('A8.6b guards: slice boundary', () => {
  it('adds no reminder endpoint, using only the three that exist', () => {
    const client = reminderClientFunctions();
    const paths = client.match(/\/api\/v1\/[^`'"]*/g) ?? [];
    const methods = client.match(/method: '(GET|PUT|DELETE|POST|PATCH)'/g) ?? [];

    expect(paths).toHaveLength(3);
    for (const value of paths) {
      expect(value.endsWith('/reminder'), `${value} is not the contracted reminder resource`).toBe(
        true,
      );
    }
    expect(methods.sort()).toEqual(["method: 'DELETE'", "method: 'GET'", "method: 'PUT'"]);
  });

  it('reads no Owner notification persistence and contacts no provider', () => {
    const code = panelCode();

    for (const forbidden of [
      'ownerNotification',
      'OwnerNotification',
      'gmail',
      'Gmail',
      'oauth',
      'OAuth',
    ]) {
      expect(code, `${forbidden} is outside A8.6b`).not.toContain(forbidden);
    }
  });

  it('reads no feature flag and knows nothing about cron', () => {
    const code = panelCode();

    for (const forbidden of [
      'ENABLE_REMINDER_DELIVERY',
      'ENABLE_OWNER_EVENT_CAPTURE',
      'ENABLE_OWNER_EVENT_DELIVERY',
      'process.env',
      'CRON_SECRET',
    ]) {
      expect(code, `${forbidden} does not belong in a UI panel`).not.toContain(forbidden);
    }
  });

  it('keeps the Task detail page a server component', () => {
    const detail = readCode(TASK_DETAIL);
    const page = readCode(TASK_PAGE);

    expect(detail).not.toContain("'use client'");
    expect(page).not.toContain("'use client'");
    // Only the panel and its dialog are client islands.
    expect(readCode(PANEL)).toContain("'use client'");
    expect(readCode(DIALOG)).toContain("'use client'");
  });

  it('loads the initial reminder state on the server, through the existing service', () => {
    const page = readCode(TASK_PAGE);

    expect(page).toContain('getOwnerTaskReminder');
    expect(page).toContain('initialReminder={reminder}');
  });
});

describe('A8.6b guards: truthfulness', () => {
  it('never claims a reminder email was sent by a configuration change', () => {
    const code = panelCode();

    expect(code).not.toMatch(/reminder (has been|was) sent to/i);
    expect(code).not.toMatch(/we (have )?(sent|emailed)/i);
  });

  it('keeps the ambiguity wording D129 requires', () => {
    expect(readCode(STOP_COPY)).toContain('may or may not have received');
  });

  it('shares one stop-reason source with the attention surface', () => {
    const attention = readCode(path.join(webRoot, 'lib/reminders/attention.ts'));

    expect(attention).toContain('ATTENTION_STOP_REASON_COPY');
    expect(readCode(PRESENTATION)).toContain('ATTENTION_STOP_REASON_COPY');
  });

  it('derives editability from the domain rather than restating it', () => {
    expect(readCode(PRESENTATION)).toContain('decideReminderScheduling');
  });

  it('takes the delivery ceiling from the domain constant', () => {
    const presentation = readCode(PRESENTATION);

    expect(presentation).toContain('OVERDUE_SUCCESSFUL_DELIVERY_CEILING');
    // A hard-coded 14 would drift the day the policy changes.
    expect(presentation).not.toMatch(/\bof 14\b/);
  });
});
