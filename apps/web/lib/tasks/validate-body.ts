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
type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];
type TaskOutcomeType = components['schemas']['TaskOutcomeType'];
type TaskPriority = components['schemas']['TaskPriority'];

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

function fail(message: string): { ok: false; response: NextResponse<ErrorResponse> } {
  return {
    ok: false,
    response: jsonErrorResponse('VALIDATION_ERROR', message, 400),
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
  if (!Array.isArray(body.summaryPoints) || body.summaryPoints.length < 1) {
    return fail('summaryPoints must contain between 1 and 20 points.');
  }
  if (body.summaryPoints.length > 20 || !body.summaryPoints.every(isSummaryPoint)) {
    return fail('summaryPoints is invalid.');
  }
  if (body.recipientId !== undefined && typeof body.recipientId !== 'string') {
    return fail('recipientId must be a string.');
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
      recipientId: body.recipientId as string | undefined,
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
