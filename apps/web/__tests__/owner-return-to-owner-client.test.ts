import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@aicaa/contracts/schema';
import { postTaskReturnToOwner } from '@/lib/owner/api-client';
import { RequestTimeoutError } from '@/lib/http/client-timeout';

type TaskDto = components['schemas']['Task'];

const TASK_ID = 'task_return_client';
const TASK_ETAG = '"task-task_return_client-v3"';

const unassigned: TaskDto = {
  id: TASK_ID,
  organizationId: 'org_ui',
  status: 'in_progress',
  priorActionableStatus: null,
  summaryPoints: [],
  sourceReference: { sourceType: 'gmail' },
  dueAt: null,
  waitingUntil: null,
  priority: 'normal',
  derivedUrgency: null,
  notes: [],
  reminder: {
    nextReminderAt: null,
    reminderStage: 0,
    waitingPaused: false,
  },
  retention: {
    deleteAfter: '2026-08-18T00:00:00.000Z',
    policy: 'active_task',
  },
  version: 4,
  etag: '"task-task_return_client-v4"',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.etag) {
    headers.set('ETag', init.etag);
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
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

function lastInit(): RequestInit {
  return (fetchMock.mock.calls.at(-1)?.[1] ?? {}) as RequestInit;
}

function headerValue(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe('Owner return-to-owner API client', () => {
  it('POSTs the Owner return-to-owner route with the current Task If-Match and no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(unassigned, { etag: unassigned.etag }));

    const result = await postTaskReturnToOwner({ taskId: TASK_ID, ifMatch: TASK_ETAG });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.assignment).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/api/v1/tasks/${TASK_ID}/return-to-owner`,
    );
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(headerValue(init, 'If-Match')).toBe(TASK_ETAG);
    expect(headerValue(init, 'Idempotency-Key')).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe('no-store');
  });

  it('reports a stale If-Match as a precondition failure without inventing a second request', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'PRECONDITION_FAILED' } }, { status: 412 }),
    );

    const result = await postTaskReturnToOwner({ taskId: TASK_ID, ifMatch: TASK_ETAG });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.status).toBe(412);
    expect(result.error.outcomeCategory).toBe('stale');
    expect(result.error.refetchTask).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout as ambiguous and does not automatically repeat the mutation', async () => {
    fetchMock.mockRejectedValue(new RequestTimeoutError(35_000));

    const result = await postTaskReturnToOwner({ taskId: TASK_ID, ifMatch: TASK_ETAG });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.outcomeCategory).toBe('ambiguous');
    expect(result.error.allowNewOperation).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
