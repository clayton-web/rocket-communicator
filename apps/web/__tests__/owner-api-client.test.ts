// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnerTask, postTaskHandoff, startGmailOAuthNavigation } from '@/lib/owner/api-client';
import { CLIENT_REQUEST_TIMEOUT_MS } from '@/lib/http/client-timeout';
import { GMAIL_SEND_TIMEOUT_MS } from '@/lib/gmail/gmail-api-client';

describe('A7.8 Owner API client OAuth navigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses a top-level HTML form POST rather than a background fetch', () => {
    const submit = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'form') {
        Object.defineProperty(el, 'submit', { value: submit });
      }
      return el;
    });

    startGmailOAuthNavigation('/tasks/task_abc');

    expect(submit).toHaveBeenCalledTimes(1);
    const form = document.body.querySelector('form');
    expect(form?.method.toLowerCase()).toBe('post');
    expect(form?.action).toContain('/api/v1/gmail/oauth/start');
    expect(form?.action).toContain('returnPath=%2Ftasks%2Ftask_abc');
    expect(form?.action).not.toContain('Idempotency');
    expect(form?.action).not.toContain('recipient');
  });
});

describe('Owner API client request timeouts (P1.3 / D112)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function hangingFetch() {
    return vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
  }

  it('waits longer than the server allows its own Gmail send', () => {
    // The handoff route bounds the Gmail send at GMAIL_SEND_TIMEOUT_MS. Giving up first
    // would report a send that is still running, and will most likely succeed, as an
    // ambiguous outcome the Owner then has to reconcile by hand.
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBeGreaterThan(GMAIL_SEND_TIMEOUT_MS);
  });

  it('reports a timed-out handoff as ambiguous without inventing a replacement mutation', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const pending = postTaskHandoff({
      taskId: 'task_1',
      recipientId: 'rcp_1',
      ifMatch: 'W/"task:task_1:3"',
      idempotencyKey: 'key-123',
    });
    await vi.advanceTimersByTimeAsync(CLIENT_REQUEST_TIMEOUT_MS);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.outcomeCategory).toBe('ambiguous');
    expect(result.error.status).toBe(0);
    expect(result.error.allowSameKeyRetry).toBe(true);
    expect(result.error.allowNewOperation).toBe(false);

    // Exactly one attempt, carrying the original concurrency and idempotency metadata.
    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"task:task_1:3"');
    expect(headers['Idempotency-Key']).toBe('key-123');
  });

  it('replays an ambiguous mutation with byte-identical headers and body', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const attempt = {
      taskId: 'task_1',
      recipientId: 'rcp_1',
      ifMatch: 'W/"task:task_1:3"',
      idempotencyKey: 'key-123',
    };

    for (let round = 0; round < 2; round += 1) {
      const pending = postTaskHandoff(attempt);
      await vi.advanceTimersByTimeAsync(CLIENT_REQUEST_TIMEOUT_MS);
      await pending;
    }

    // A manual retry after an ambiguous outcome must be the same logical operation, or the
    // server cannot recognise it as a replay and could deliver a second email.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] ?? [];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] ?? [];
    expect(secondUrl).toBe(firstUrl);
    expect(secondInit?.method).toBe(firstInit?.method);
    expect(secondInit?.headers).toEqual(firstInit?.headers);
    expect(secondInit?.body).toBe(firstInit?.body);
  });

  it('still surfaces a confirmed 412 as a precondition failure rather than a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'PRECONDITION_FAILED' } }), {
            status: 412,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const result = await postTaskHandoff({
      taskId: 'task_1',
      recipientId: 'rcp_1',
      ifMatch: 'W/"task:task_1:3"',
      idempotencyKey: 'key-123',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.status).toBe(412);
    expect(result.error.outcomeCategory).toBe('stale');
    expect(result.error.refetchTask).toBe(true);
  });

  it('reports a failed read as retryable rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const result = await fetchOwnerTask('task_1');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.status).toBe(0);
    expect(result.error.outcomeCategory).toBe('unknown');
  });
});
