import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  fetchWithTimeout,
  isRequestTimeoutError,
} from '@/lib/http/client-timeout';
import {
  classifyTransportFailure,
  parsePublicErrorResponse,
} from '@/lib/handoff/client/public-errors';

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * A request that never settles on its own and only rejects when aborted, matching real
 * `fetch` semantics for a signal that is already aborted at call time.
 */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(abortError());
          return;
        }
        init?.signal?.addEventListener('abort', () => reject(abortError()));
      }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('documents a single shared timeout constant', () => {
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBe(35_000);
  });

  it('returns a successful response received before the timeout', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'task_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithTimeout('/api/v1/tasks/task_1');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('clears its timer once the request settles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, {})),
    );

    await fetchWithTimeout('/api/v1/tasks');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(fetchWithTimeout('/api/v1/tasks')).rejects.toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('raises a timeout error and issues no second request', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithTimeout('/api/v1/tasks/task_1/handoff', { method: 'POST' });
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(CLIENT_REQUEST_TIMEOUT_MS);
    await assertion;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not time out just before the deadline', async () => {
    vi.stubGlobal('fetch', hangingFetch());

    let settled = false;
    const pending = fetchWithTimeout('/api/v1/tasks').catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(CLIENT_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('passes an ordinary network failure through unchanged', async () => {
    const failure = new TypeError('NetworkError when attempting to fetch resource.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw failure;
      }),
    );

    await expect(fetchWithTimeout('/api/v1/tasks')).rejects.toBe(failure);
  });

  it.each([400, 401, 403, 404, 409, 412, 500, 503])(
    'returns a %i response instead of throwing',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(status, { error: { code: 'DOMAIN_CONFLICT' } })),
      );

      const response = await fetchWithTimeout('/api/v1/tasks/task_1/handoff', { method: 'POST' });

      expect(response.status).toBe(status);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('hands back a malformed error body untouched for the caller to classify', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );

    const response = await fetchWithTimeout('/api/v1/tasks');

    expect(response.status).toBe(502);
    expect(parsePublicErrorResponse(response.status, undefined).outcomeCategory).toBe('unknown');
  });

  it('prefers a response that wins the race against its own deadline', async () => {
    // The response resolves on the same tick the timer would fire. A late timer must not
    // convert an answer the caller already has into a timeout.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(jsonResponse(200, { ok: true })), CLIENT_REQUEST_TIMEOUT_MS);
          }),
      ),
    );

    const pending = fetchWithTimeout('/api/v1/tasks');
    await vi.advanceTimersByTimeAsync(CLIENT_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-throws a caller abort without calling it a timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();

    const pending = fetchWithTimeout('/api/v1/tasks', { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;

    await expect(pending.catch((error) => isRequestTimeoutError(error))).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('respects a signal that is already aborted', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithTimeout('/api/v1/tasks', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('transport failure classification (D112)', () => {
  it('treats a mutation timeout as genuinely ambiguous and replayable', () => {
    const classified = classifyTransportFailure({ kind: 'timeout', mutation: true });

    expect(classified.status).toBe(0);
    expect(classified.outcomeCategory).toBe('ambiguous');
    // Same Idempotency-Key / If-Match replay stays available; a fresh operation does not.
    expect(classified.allowSameKeyRetry).toBe(true);
    expect(classified.allowNewOperation).toBe(false);
    expect(classified.message).toMatch(/may or may not/i);
    expect(classified.message).not.toMatch(/success|succeeded|complete/i);
  });

  it('is never confused with a confirmed precondition failure', () => {
    const timeout = classifyTransportFailure({ kind: 'timeout', mutation: true });
    const confirmed412 = parsePublicErrorResponse(412, {
      error: { code: 'PRECONDITION_FAILED' },
    });

    expect(timeout.status).not.toBe(412);
    expect(timeout.code).not.toBe('PRECONDITION_FAILED');
    expect(timeout.outcomeCategory).not.toBe(confirmed412.outcomeCategory);
  });

  it('keeps a confirmed 412 on the refresh-and-new-attempt path', () => {
    const confirmed412 = parsePublicErrorResponse(412, {
      error: { code: 'PRECONDITION_FAILED' },
    });

    expect(confirmed412.outcomeCategory).toBe('stale');
    expect(confirmed412.refetchTask).toBe(true);
    expect(confirmed412.allowNewOperation).toBe(true);
    expect(confirmed412.allowSameKeyRetry).toBe(false);
  });

  it('treats a read failure as simply retryable', () => {
    const classified = classifyTransportFailure({ kind: 'network', mutation: false });

    expect(classified.outcomeCategory).toBe('unknown');
    expect(classified.allowSameKeyRetry).toBe(false);
    expect(classified.refetchTask).toBe(false);
  });
});
