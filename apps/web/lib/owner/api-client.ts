/**
 * Thin Owner browser API client (A7.8).
 * All requests use cache: 'no-store'. Never logs bodies, keys, or emails.
 * Every request is bounded by the shared client timeout (P1.3 / D112); a request that
 * produces no response is reported truthfully rather than as a server rejection.
 */

import type { components } from '@aicaa/contracts/schema';
import {
  classifyTransportFailure,
  parsePublicErrorResponse,
  type ParsedPublicError,
} from '@/lib/handoff/client/public-errors';
import { fetchWithTimeout, isRequestTimeoutError } from '@/lib/http/client-timeout';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type ListRecipientsResponse = components['schemas']['ListRecipientsResponse'];
type HandoffTaskResponse = components['schemas']['HandoffTaskResponse'];
type GmailConnectionDto = components['schemas']['GmailConnection'];
type TaskReminderStateDto = components['schemas']['TaskReminderState'];

export type OwnerApiError = ParsedPublicError;

export type OwnerApiResult<T> =
  { ok: true; data: T; etag?: string | null } | { ok: false; error: OwnerApiError };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function fail(status: number, body: unknown): OwnerApiResult<never> {
  return { ok: false, error: parsePublicErrorResponse(status, body) };
}

/**
 * Run one bounded request. A completed response — success or error — is handed back to
 * the caller untouched. Only a request that produced no response is classified here.
 */
async function send(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { mutation: boolean },
): Promise<{ ok: true; response: Response } | { ok: false; error: ParsedPublicError }> {
  try {
    return { ok: true, response: await fetchWithTimeout(input, init) };
  } catch (error) {
    return {
      ok: false,
      error: classifyTransportFailure({
        kind: isRequestTimeoutError(error) ? 'timeout' : 'network',
        mutation: options.mutation,
      }),
    };
  }
}

export async function fetchOwnerTask(taskId: string): Promise<OwnerApiResult<TaskDto>> {
  const sent = await send(
    `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    { mutation: false },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return {
    ok: true,
    data: body as TaskDto,
    etag: response.headers.get('etag'),
  };
}

export async function fetchOwnerTasks(input?: {
  cursor?: string | null;
  limit?: number;
}): Promise<OwnerApiResult<{ items: TaskDto[]; nextCursor: string | null }>> {
  const url = new URL('/api/v1/tasks', window.location.origin);
  if (input?.cursor) {
    url.searchParams.set('cursor', input.cursor);
  }
  if (input?.limit) {
    url.searchParams.set('limit', String(input.limit));
  }
  const sent = await send(
    url.pathname + url.search,
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    { mutation: false },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  const page = body as { items: TaskDto[]; nextCursor: string | null };
  return { ok: true, data: { items: page.items ?? [], nextCursor: page.nextCursor ?? null } };
}

export async function fetchActiveRecipients(input?: {
  cursor?: string | null;
  limit?: number;
}): Promise<OwnerApiResult<{ items: RecipientDto[]; nextCursor: string | null }>> {
  const url = new URL('/api/v1/recipients', window.location.origin);
  if (input?.cursor) {
    url.searchParams.set('cursor', input.cursor);
  }
  if (input?.limit) {
    url.searchParams.set('limit', String(input.limit));
  }
  const sent = await send(
    url.pathname + url.search,
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    { mutation: false },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  const page = body as ListRecipientsResponse;
  return { ok: true, data: { items: page.items ?? [], nextCursor: page.nextCursor ?? null } };
}

export async function fetchGmailConnection(): Promise<OwnerApiResult<GmailConnectionDto>> {
  const sent = await send(
    '/api/v1/gmail/connection',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    { mutation: false },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return { ok: true, data: body as GmailConnectionDto };
}

export async function postTaskHandoff(input: {
  taskId: string;
  recipientId: string;
  ifMatch: string;
  idempotencyKey: string;
}): Promise<OwnerApiResult<HandoffTaskResponse>> {
  const sent = await send(
    `/api/v1/tasks/${encodeURIComponent(input.taskId)}/handoff`,
    {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'If-Match': input.ifMatch,
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        recipientId: input.recipientId,
        acknowledgement: 'handoff_confirmed_v1',
      }),
    },
    { mutation: true },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return {
    ok: true,
    data: body as HandoffTaskResponse,
    etag: response.headers.get('etag'),
  };
}

/*
 * Reminder resource (A8.6b).
 *
 * Three deliberate differences from the handoff mutation above.
 *
 * `If-Match` carries the *reminder* ETag, never the Task's. A reminder write does not bump
 * `Task.version`, so a Task ETag stays valid across a reminder change it cannot describe, and the
 * route rejects one presented here with `412`.
 *
 * There is no `Idempotency-Key`. The reminder contract does not define one, and inventing a header
 * the server ignores would suggest a replay guarantee that does not exist. Safety comes from the
 * ETag: a replayed `PUT` either matches the current version and is the semantically idempotent
 * same-date save, or it does not and is refused.
 *
 * The response ETag is read from the header rather than the body so the caller adopts the token the
 * transport actually returned.
 */

export async function fetchTaskReminder(
  taskId: string,
): Promise<OwnerApiResult<TaskReminderStateDto>> {
  const sent = await send(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/reminder`,
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    },
    { mutation: false },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return {
    ok: true,
    data: body as TaskReminderStateDto,
    etag: response.headers.get('etag'),
  };
}

export async function putTaskReminder(input: {
  taskId: string;
  dueLocalDate: string;
  ifMatch: string;
}): Promise<OwnerApiResult<TaskReminderStateDto>> {
  const sent = await send(
    `/api/v1/tasks/${encodeURIComponent(input.taskId)}/reminder`,
    {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'If-Match': input.ifMatch,
      },
      body: JSON.stringify({ dueLocalDate: input.dueLocalDate }),
    },
    { mutation: true },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return {
    ok: true,
    data: body as TaskReminderStateDto,
    etag: response.headers.get('etag'),
  };
}

export async function deleteTaskReminder(input: {
  taskId: string;
  ifMatch: string;
}): Promise<OwnerApiResult<TaskReminderStateDto>> {
  const sent = await send(
    `/api/v1/tasks/${encodeURIComponent(input.taskId)}/reminder`,
    {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'If-Match': input.ifMatch,
      },
    },
    { mutation: true },
  );
  if (!sent.ok) {
    return sent;
  }
  const response = sent.response;
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  return {
    ok: true,
    data: body as TaskReminderStateDto,
    etag: response.headers.get('etag'),
  };
}

/**
 * Navigate the top-level browser through POST /api/v1/gmail/oauth/start (302 to Google).
 * Must not use a background fetch that swallows the redirect.
 */
export function startGmailOAuthNavigation(returnPath: string): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/v1/gmail/oauth/start?returnPath=${encodeURIComponent(returnPath)}`;
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
}
