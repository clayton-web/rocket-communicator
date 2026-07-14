import type { components } from '@aicaa/contracts/schema';
import type { RecipientUiAction } from '@/lib/capability/available-actions';

type TaskDto = components['schemas']['Task'];
type TaskOutcomeType = components['schemas']['TaskOutcomeType'];

export type RecipientMutationResult =
  | { ok: true; task: TaskDto; status: number }
  | { ok: true; workRequest: components['schemas']['SubmitWorkRequestResponse']; status: 201 }
  | { ok: false; status: number; code?: string; message: string };

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

  const response = await fetch(apiBase(input.token, input.taskId, pathByAction[input.action]), {
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
  });

  if (!response.ok) {
    const err = await parseError(response);
    return { ok: false, status: response.status, code: err.code, message: err.message };
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
  const response = await fetch(apiBase(input.token, input.taskId), {
    method: 'GET',
    referrerPolicy: 'no-referrer',
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    const err = await parseError(response);
    return { ok: false, status: response.status, code: err.code, message: err.message };
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
