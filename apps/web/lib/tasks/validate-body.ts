import { jsonErrorResponse } from '@/lib/auth/http';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];
type CreateTaskRequest = components['schemas']['CreateTaskRequest'];
type MarkTaskWaitingRequest = components['schemas']['MarkTaskWaitingRequest'];
type CompleteTaskRequest = components['schemas']['CompleteTaskRequest'];
type AddTaskNoteRequest = components['schemas']['AddTaskNoteRequest'];
type ReturnTaskToOwnerRequest = components['schemas']['ReturnTaskToOwnerRequest'];
type RequestClarificationRequest = components['schemas']['RequestClarificationRequest'];
type SnoozeTaskRequest = components['schemas']['SnoozeTaskRequest'];
type DismissTaskRequest = components['schemas']['DismissTaskRequest'];
type IssueTaskCapabilityRequest = components['schemas']['IssueTaskCapabilityRequest'];
type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];
type TaskOutcomeType = components['schemas']['TaskOutcomeType'];
type TaskPriority = components['schemas']['TaskPriority'];
type CapabilityAction = components['schemas']['CapabilityAction'];
type CapabilityScope = components['schemas']['CapabilityScope'];

const OUTCOME_TYPES = new Set<TaskOutcomeType>([
  'completed',
  'spoke_with_contact',
  'email_sent',
  'text_sent',
  'scheduled',
  'information_provided',
  'no_action_required',
  'other',
]);

const PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

const CAPABILITY_ACTIONS = new Set<CapabilityAction>([
  'view_assigned_task',
  'complete_task',
  'mark_task_waiting',
  'add_task_note',
  'record_completion_outcome',
  'return_task_to_owner',
  'request_clarification',
  'submit_work_request',
]);

/**
 * D091 / A7.6: create-task must reject any supplied top-level `recipientId`. Assignment happens
 * only through the dedicated handoff workflow (create unassigned, then hand off).
 */
export const RECIPIENT_HANDOFF_REJECTION_MESSAGE =
  'Create the Task without a recipientId, then assign it through the handoff workflow.';

function fail(message: string): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponse('VALIDATION_ERROR', message, 400),
  };
}

function rejectRecipientId(): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponse(
      'RECIPIENT_HANDOFF_NOT_AVAILABLE',
      RECIPIENT_HANDOFF_REJECTION_MESSAGE,
      400,
    ),
  };
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isSummaryPoint(value: unknown): value is TaskSummaryPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const point = value as Record<string, unknown>;
  return (
    typeof point.id === 'string' &&
    point.id.length >= 1 &&
    point.id.length <= 64 &&
    typeof point.kind === 'string' &&
    typeof point.label === 'string' &&
    typeof point.order === 'number' &&
    Number.isInteger(point.order) &&
    point.order >= 0 &&
    point.order <= 19
  );
}

export function parseCreateTaskBody(
  body: Record<string, unknown>,
): { ok: true; value: CreateTaskRequest } | { ok: false; response: NextResponse<ErrorResponse> } {
  // D091 / A7.6: reject immediately if the body owns a top-level `recipientId` key, regardless of
  // its value (UUID, null, empty string, number, boolean, object, array). Own-property presence —
  // never truthiness, `!== null`, or raw-body scanning. Only complete omission is permitted. This
  // runs before any other validation so no side effect can occur before rejection.
  if (Object.prototype.hasOwnProperty.call(body, 'recipientId')) {
    return rejectRecipientId();
  }
  if (!Array.isArray(body.summaryPoints) || body.summaryPoints.length < 1) {
    return fail('summaryPoints must contain between 1 and 20 points.');
  }
  if (body.summaryPoints.length > 20 || !body.summaryPoints.every(isSummaryPoint)) {
    return fail('summaryPoints is invalid.');
  }
  if (body.dueAt !== undefined && !isIsoDateTime(body.dueAt)) {
    return fail('dueAt must be an ISO date-time.');
  }
  if (body.priority !== undefined && !PRIORITIES.has(body.priority as TaskPriority)) {
    return fail('priority is invalid.');
  }
  return {
    ok: true,
    value: {
      summaryPoints: body.summaryPoints as TaskSummaryPoint[],
      dueAt: body.dueAt as string | undefined,
      priority: body.priority as TaskPriority | undefined,
      sourceReference: body.sourceReference as CreateTaskRequest['sourceReference'],
    },
  };
}

export function parseWaitingBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: MarkTaskWaitingRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!isIsoDateTime(body.waitingUntil)) {
    return fail('waitingUntil must be an ISO date-time.');
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return fail('reason must be a string.');
  }
  return {
    ok: true,
    value: {
      waitingUntil: body.waitingUntil,
      reason: body.reason as string | undefined,
    },
  };
}

export function parseCompleteBody(
  body: Record<string, unknown>,
): { ok: true; value: CompleteTaskRequest } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!OUTCOME_TYPES.has(body.outcomeType as TaskOutcomeType)) {
    return fail('outcomeType is required and must be a valid enum value.');
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return fail('note must be a string.');
  }
  return {
    ok: true,
    value: {
      outcomeType: body.outcomeType as TaskOutcomeType,
      note: body.note as string | undefined,
      summaryPoints: body.summaryPoints as CompleteTaskRequest['summaryPoints'],
      followUpProposal: body.followUpProposal as CompleteTaskRequest['followUpProposal'],
    },
  };
}

export function parseNoteBody(
  body: Record<string, unknown>,
): { ok: true; value: AddTaskNoteRequest } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (typeof body.body !== 'string' || body.body.trim().length < 1) {
    return fail('body is required.');
  }
  if (body.body.length > 2000) {
    return fail('body exceeds 2000 characters.');
  }
  return { ok: true, value: { body: body.body } };
}

export function parseClarificationBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: RequestClarificationRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (typeof body.message !== 'string' || body.message.trim().length < 1) {
    return fail('message is required.');
  }
  if (body.message.length > 2000) {
    return fail('message exceeds 2000 characters.');
  }
  return { ok: true, value: { message: body.message } };
}

export function parseSnoozeBody(
  body: Record<string, unknown>,
): { ok: true; value: SnoozeTaskRequest } | { ok: false; response: NextResponse<ErrorResponse> } {
  if (!isIsoDateTime(body.nextReminderAt)) {
    return fail('nextReminderAt must be an ISO date-time.');
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return fail('reason must be a string.');
  }
  return {
    ok: true,
    value: {
      nextReminderAt: body.nextReminderAt,
      reason: body.reason as string | undefined,
    },
  };
}

export function parseOptionalNoteBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ReturnTaskToOwnerRequest | DismissTaskRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (body.note !== undefined && typeof body.note !== 'string') {
    return fail('note must be a string.');
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return fail('reason must be a string.');
  }
  return {
    ok: true,
    value: {
      note: body.note as string | undefined,
      reason: body.reason as string | undefined,
    },
  };
}

/** Validates optional IssueTaskCapabilityRequest (scope override only; no TTL/replace flags). */
export function parseIssueCapabilityBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: IssueTaskCapabilityRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (body.scope === undefined) {
    return { ok: true, value: {} };
  }
  if (!Array.isArray(body.scope)) {
    return fail('scope must be an array of capability actions.');
  }
  if (body.scope.length < 1 || body.scope.length > 8) {
    return fail('scope must contain between 1 and 8 actions.');
  }
  const seen = new Set<string>();
  for (const action of body.scope) {
    if (typeof action !== 'string' || !CAPABILITY_ACTIONS.has(action as CapabilityAction)) {
      return fail('scope contains an invalid capability action.');
    }
    if (seen.has(action)) {
      return fail('scope must not contain duplicate actions.');
    }
    seen.add(action);
  }
  return {
    ok: true,
    value: {
      scope: body.scope as CapabilityScope,
    },
  };
}
