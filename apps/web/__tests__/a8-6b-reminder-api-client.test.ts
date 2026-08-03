import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { deleteTaskReminder, fetchTaskReminder, putTaskReminder } from '@/lib/owner/api-client';
import { classifyReminderError } from '@/lib/reminders/client/public-errors';
import { RequestTimeoutError } from '@/lib/http/client-timeout';
import { parseETag } from '@aicaa/domain';

type TaskReminderState = components['schemas']['TaskReminderState'];

const TASK_ID = 'task_a86b_client';
const REMINDER_ETAG = '"task-reminder-task_a86b_client-v4"';
const TASK_ETAG = '"task-task_a86b_client-v4"';

const reminderState: TaskReminderState = {
  taskId: TASK_ID,
  etag: REMINDER_ETAG,
  dueLocalDate: '2026-08-20',
  schedulingTimeZone: 'America/Vancouver',
  state: 'active',
  generation: 1,
  advance: {
    disposition: 'scheduled',
    occurrence: { localDate: '2026-08-18', at: '2026-08-18T16:00:00.000Z' },
  },
  nextOverdueOccurrence: null,
  overdueDeliveredCount: 0,
  requiresOwnerAttention: false,
  stopReason: null,
};

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.etag) {
    headers.set('ETag', init.etag);
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code, message: 'redacted' } }, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastRequest(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  return { url: String(call?.[0]), init: (call?.[1] ?? {}) as RequestInit };
}

function headerValue(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe('A8.6b reminder API client: requests', () => {
  it('reads the reminder resource and adopts the ETag from the response header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reminderState, { etag: REMINDER_ETAG }));

    const result = await fetchTaskReminder(TASK_ID);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.state).toBe('active');
    expect(result.ok && result.etag).toBe(REMINDER_ETAG);
    expect(lastRequest().url).toBe(`/api/v1/tasks/${TASK_ID}/reminder`);
    expect(lastRequest().init.method).toBe('GET');
    // A cached reminder state is a wrong reminder state.
    expect(lastRequest().init.cache).toBe('no-store');
  });

  it('sends the reminder ETag as If-Match on PUT', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reminderState, { etag: REMINDER_ETAG }));

    await putTaskReminder({ taskId: TASK_ID, dueLocalDate: '2026-09-01', ifMatch: REMINDER_ETAG });

    const { init } = lastRequest();
    expect(init.method).toBe('PUT');
    expect(headerValue(init, 'If-Match')).toBe(REMINDER_ETAG);
    expect(JSON.parse(String(init.body))).toEqual({ dueLocalDate: '2026-09-01' });
  });

  it('sends the reminder ETag as If-Match on DELETE, with no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ...reminderState, state: 'no_due_date' },
        { etag: '"task-reminder-task_a86b_client-v5"' },
      ),
    );

    await deleteTaskReminder({ taskId: TASK_ID, ifMatch: REMINDER_ETAG });

    const { init } = lastRequest();
    expect(init.method).toBe('DELETE');
    expect(headerValue(init, 'If-Match')).toBe(REMINDER_ETAG);
    expect(init.body).toBeUndefined();
  });

  /*
   * The two ETags are different resources, and this is the trap A8.6b was warned about.
   *
   * A reminder change does not bump `Task.version`, so a Task ETag stays valid across a reminder
   * change it cannot describe. Presenting one here would pass the client's own checks and be refused
   * by the route with a `412` — the failure would look like a concurrency conflict rather than the
   * wiring mistake it is.
   */
  it('sends a token of the reminder kind, never the Task kind', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reminderState, { etag: REMINDER_ETAG }));

    await putTaskReminder({ taskId: TASK_ID, dueLocalDate: '2026-09-01', ifMatch: REMINDER_ETAG });

    const sent = headerValue(lastRequest().init, 'If-Match');
    expect(parseETag(String(sent))?.kind).toBe('task-reminder');
    expect(parseETag(TASK_ETAG)?.kind).toBe('task');
    expect(sent).not.toBe(TASK_ETAG);
  });

  /*
   * No `Idempotency-Key`. The reminder contract does not define one, and sending a header the server
   * ignores would imply a replay guarantee that does not exist.
   */
  it('sends no Idempotency-Key on either mutation', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reminderState, { etag: REMINDER_ETAG }));

    await putTaskReminder({ taskId: TASK_ID, dueLocalDate: '2026-09-01', ifMatch: REMINDER_ETAG });
    expect(headerValue(lastRequest().init, 'Idempotency-Key')).toBeUndefined();

    await deleteTaskReminder({ taskId: TASK_ID, ifMatch: REMINDER_ETAG });
    expect(headerValue(lastRequest().init, 'Idempotency-Key')).toBeUndefined();
  });

  it('performs exactly one request per call, so a failure cannot become a duplicate write', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await putTaskReminder({ taskId: TASK_ID, dueLocalDate: '2026-09-01', ifMatch: REMINDER_ETAG });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('A8.6b reminder API client: outcome classification', () => {
  it('reports a refused precondition as a concurrency condition needing a re-read', async () => {
    fetchMock.mockResolvedValue(errorResponse(412, 'PRECONDITION_FAILED'));

    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: REMINDER_ETAG,
    });
    expect(result.ok).toBe(false);

    const outcome = classifyReminderError((result as { ok: false; error: never }).error);
    expect(outcome.kind).toBe('stale');
    expect(outcome.reread).toBe(true);
    // Not a failure in a final sense.
    expect(outcome.message).not.toMatch(/\bfailed\b/i);
  });

  it('reports a domain conflict as a definite refusal that no re-read will change', async () => {
    fetchMock.mockResolvedValue(errorResponse(409, 'DOMAIN_CONFLICT'));

    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: REMINDER_ETAG,
    });
    const outcome = classifyReminderError((result as { ok: false; error: never }).error);

    expect(outcome.kind).toBe('conflict');
    expect(outcome.reread).toBe(false);
    expect(outcome.message).toContain('nothing was saved');
  });

  it('reports a validation error against the date without blaming the Task', async () => {
    fetchMock.mockResolvedValue(errorResponse(400, 'VALIDATION_ERROR'));

    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-02-30',
      ifMatch: REMINDER_ETAG,
    });
    const outcome = classifyReminderError((result as { ok: false; error: never }).error);

    expect(outcome.kind).toBe('validation');
    expect(outcome.message).toContain('due date');
  });

  /*
   * A timeout is not a rejection. The server may have applied the change and failed to answer, so
   * the only honest report is that the outcome is unknown until it is read back (D112, D132).
   */
  it('reports a timeout as an unknown outcome, not a failure', async () => {
    fetchMock.mockRejectedValue(new RequestTimeoutError(35_000));

    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: REMINDER_ETAG,
    });
    const outcome = classifyReminderError((result as { ok: false; error: never }).error);

    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.reread).toBe(true);
    expect(outcome.message).toContain('may or may not have been saved');
    expect(outcome.message).not.toMatch(/\bfailed\b/i);
  });

  it('reports a dropped connection as an unknown outcome too', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await deleteTaskReminder({ taskId: TASK_ID, ifMatch: REMINDER_ETAG });
    const outcome = classifyReminderError((result as { ok: false; error: never }).error);

    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.reread).toBe(true);
  });

  it('speaks about reminders rather than handoffs, whatever the shared parser says', async () => {
    fetchMock.mockResolvedValue(errorResponse(409, 'DOMAIN_CONFLICT'));

    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: REMINDER_ETAG,
    });
    const outcome = classifyReminderError((result as { ok: false; error: never }).error);

    expect(outcome.message).not.toMatch(/handoff|gmail|recipient/i);
  });

  it('treats a missing precondition as the defect it is', () => {
    const outcome = classifyReminderError({
      status: 428,
      code: 'PRECONDITION_REQUIRED',
      message: 'ignored',
      outcomeCategory: 'validation',
      allowSameKeyRetry: false,
      allowNewOperation: true,
      refetchTask: true,
      refetchRecipients: false,
    });

    expect(outcome.kind).toBe('precondition_missing');
    expect(outcome.message).toContain('nothing was saved');
  });

  it('never claims a reminder email was sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reminderState, { etag: REMINDER_ETAG }));
    const result = await putTaskReminder({
      taskId: TASK_ID,
      dueLocalDate: '2026-09-01',
      ifMatch: REMINDER_ETAG,
    });

    expect(result.ok).toBe(true);
    for (const status of [400, 409, 412, 428, 500]) {
      const outcome = classifyReminderError({
        status,
        code: 'UNKNOWN',
        message: 'ignored',
        outcomeCategory: 'unknown',
        allowSameKeyRetry: false,
        allowNewOperation: false,
        refetchTask: false,
        refetchRecipients: false,
      });
      expect(outcome.message).not.toMatch(/sent|delivered|emailed/i);
    }
  });
});
