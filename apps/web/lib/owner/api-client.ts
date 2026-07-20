/**
 * Thin Owner browser API client (A7.8).
 * All requests use cache: 'no-store'. Never logs bodies, keys, or emails.
 */

import type { components } from '@aicaa/contracts/schema';
import {
  parsePublicErrorResponse,
  type ParsedPublicError,
} from '@/lib/handoff/client/public-errors';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type ListRecipientsResponse = components['schemas']['ListRecipientsResponse'];
type HandoffTaskResponse = components['schemas']['HandoffTaskResponse'];
type GmailConnectionDto = components['schemas']['GmailConnection'];

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

export async function fetchOwnerTask(taskId: string): Promise<OwnerApiResult<TaskDto>> {
  const response = await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
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
  const response = await fetch(url.pathname + url.search, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
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
  const response = await fetch(url.pathname + url.search, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const body = await readJson(response);
  if (!response.ok) {
    return fail(response.status, body);
  }
  const page = body as ListRecipientsResponse;
  return { ok: true, data: { items: page.items ?? [], nextCursor: page.nextCursor ?? null } };
}

export async function fetchGmailConnection(): Promise<OwnerApiResult<GmailConnectionDto>> {
  const response = await fetch('/api/v1/gmail/connection', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
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
  const response = await fetch(`/api/v1/tasks/${encodeURIComponent(input.taskId)}/handoff`, {
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
  });
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
