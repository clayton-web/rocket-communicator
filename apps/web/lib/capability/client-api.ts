import type { components } from '@aicaa/contracts/schema';
import type { RecipientUiAction } from '@/lib/capability/available-actions';
import { fetchWithTimeout, isRequestTimeoutError } from '@/lib/http/client-timeout';

type TaskDto = components['schemas']['Task'];
type TaskOutcomeType = components['schemas']['TaskOutcomeType'];

/**
 * Why a request did not succeed (P1.5 / D112).
 *
 * The distinction that matters is between a request that was never sent and one that was
 * sent without an answer. Both leave the Recipient without a result, but only the second
 * leaves the *server* in an unknown state, and telling someone their update "may or may not
 * have been saved" when the browser never dispatched it invents uncertainty that does not
 * exist — and sends them to re-read a Task that cannot have changed.
 */
export type RecipientMutationFailure =
  /** The browser reported itself offline, so nothing was dispatched. */
  | 'offline'
  /** Dispatched, but no definitive server response arrived. The outcome is unknown. */
  | 'ambiguous'
  /** The server answered with a definite error status. */
  | 'rejected';

export type RecipientMutationResult =
  | { ok: true; task: TaskDto; status: number }
  | { ok: true; workRequest: components['schemas']['SubmitWorkRequestResponse']; status: 201 }
  | {
      ok: false;
      failure: RecipientMutationFailure;
      status: number;
      code?: string;
      message: string;
    };

/**
 * Whether the browser is reporting a definite lack of connectivity.
 *
 * Used in one direction only, which is the only direction it is trustworthy in. When the
 * browser says it is offline, skipping dispatch is safe and lets the outcome be stated as a
 * fact rather than a possibility. `navigator.onLine === true` is never treated as evidence
 * that a request will arrive: a captive portal, a dead uplink, and a working connection all
 * report online, so a `true` reading changes nothing and the request is simply attempted.
 *
 * Guarded for the absence of `navigator` so this module stays importable during server
 * rendering, where it is never called but is evaluated.
 */
function knownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Result of a request the browser declined to send because it is offline (P1.5 / D112).
 *
 * States plainly that nothing was sent. That is not a guess: `fetch` was never called, so
 * there is no request in flight and no possibility that the server applied anything. The
 * Recipient needs a connection, not a review of Task state.
 */
function offlineFailure(mutation: boolean): RecipientMutationResult {
  return {
    ok: false,
    failure: 'offline',
    status: 0,
    message: mutation
      ? 'You appear to be offline, so this was not sent. Your details are kept here — reconnect, then confirm again.'
      : 'You appear to be offline. Reconnect, then try again.',
  };
}

/**
 * Result of a request that produced no server response (P1.3 / D112).
 *
 * `status: 0` keeps this distinct from every confirmed status — in particular it is not
 * a `412`, so the panel's stale-version recovery path is not triggered. A submission is
 * described as genuinely uncertain because the server may still have applied it.
 *
 * Reached only after dispatch, so it stays ambiguous regardless of what the rejection value
 * turns out to be. Nothing here inspects the error's type or message to guess a cause: once
 * a request has left the browser, a `TypeError`, an abort, and a dropped socket are equally
 * uninformative about whether the server committed.
 */
function transportFailure(error: unknown, mutation: boolean): RecipientMutationResult {
  const cause = isRequestTimeoutError(error)
    ? 'The server did not respond in time.'
    : 'The request could not reach the server.';
  return {
    ok: false,
    failure: 'ambiguous',
    status: 0,
    message: mutation
      ? `${cause} Your update may or may not have been saved. Reload this page to see the latest status before trying again.`
      : `${cause} Check your connection and try again.`,
  };
}

function apiBase(token: string, taskId: string, suffix = ''): string {
  return `/api/v1/capabilities/${encodeURIComponent(token)}/tasks/${encodeURIComponent(taskId)}${suffix}`;
}

async function parseError(response: Response): Promise<{ code?: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return {
      code: body.error?.code,
      message: body.error?.message ?? 'Something went wrong. Please try again.',
    };
  } catch {
    return { message: 'Something went wrong. Please try again.' };
  }
}

/**
 * POST a Recipient capability mutation. Always sends confirmation: "confirmed".
 * Uses referrerPolicy no-referrer so the capability URL is not leaked.
 */
export async function postCapabilityAction(input: {
  token: string;
  taskId: string;
  etag: string;
  action: RecipientUiAction;
  body: Record<string, unknown>;
}): Promise<RecipientMutationResult> {
  const pathByAction: Record<RecipientUiAction, string> = {
    mark_task_waiting: '/waiting',
    resume_task: '/resume',
    complete_task: '/complete',
    add_task_note: '/notes',
    request_clarification: '/clarification-requests',
    return_task_to_owner: '/return-to-owner',
    submit_work_request: '/work-requests',
  };

  /*
   * Checked before dispatch and never retried afterwards. Not sending is what makes
   * "this was not sent" true, and it is also what keeps this from becoming a retry: the
   * Recipient's next attempt is a fresh deliberate confirmation, not something the client
   * replays when connectivity returns.
   */
  if (knownOffline()) {
    return offlineFailure(true);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      apiBase(input.token, input.taskId, pathByAction[input.action]),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'if-match': input.etag,
        },
        body: JSON.stringify({
          ...input.body,
          confirmation: 'confirmed',
        }),
        referrerPolicy: 'no-referrer',
        credentials: 'same-origin',
      },
    );
  } catch (error) {
    return transportFailure(error, true);
  }

  if (!response.ok) {
    const err = await parseError(response);
    return {
      ok: false,
      failure: 'rejected',
      status: response.status,
      code: err.code,
      message: err.message,
    };
  }

  if (input.action === 'submit_work_request') {
    const workRequest =
      (await response.json()) as components['schemas']['SubmitWorkRequestResponse'];
    return { ok: true, workRequest, status: 201 };
  }

  const task = (await response.json()) as TaskDto;
  return { ok: true, task, status: response.status };
}

/** Safe non-mutating GET reload after 412. */
export async function reloadCapabilityTask(input: {
  token: string;
  taskId: string;
}): Promise<RecipientMutationResult> {
  if (knownOffline()) {
    return offlineFailure(false);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(apiBase(input.token, input.taskId), {
      method: 'GET',
      referrerPolicy: 'no-referrer',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    return transportFailure(error, false);
  }

  if (!response.ok) {
    const err = await parseError(response);
    return {
      ok: false,
      failure: 'rejected',
      status: response.status,
      code: err.code,
      message: err.message,
    };
  }

  const task = (await response.json()) as TaskDto;
  return { ok: true, task, status: 200 };
}

export const OUTCOME_OPTIONS: ReadonlyArray<{ value: TaskOutcomeType; label: string }> = [
  { value: 'completed', label: 'Completed' },
  { value: 'spoke_with_contact', label: 'Spoke with contact' },
  { value: 'email_sent', label: 'Email sent' },
  { value: 'text_sent', label: 'Text sent' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'information_provided', label: 'Information provided' },
  { value: 'no_action_required', label: 'No action required' },
  { value: 'other', label: 'Other' },
];

export function publicErrorMessage(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return 'This link is invalid or no longer available.';
    case 403:
      return 'This link does not permit that action.';
    case 404:
      return 'The assigned task is unavailable.';
    case 409:
      return 'The task changed or that action is no longer allowed.';
    case 412:
      return 'The task was updated. Please review the latest details and try again.';
    case 428:
      return 'Something went wrong. Please refresh and try again.';
    case 500:
      return 'A temporary error occurred. Please try again later.';
    default:
      return fallback || 'Something went wrong. Please try again.';
  }
}
