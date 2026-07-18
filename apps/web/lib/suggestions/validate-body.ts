import { jsonErrorResponse } from '@/lib/auth/http';
import type { NextResponse } from 'next/server';
import type { components } from '@aicaa/contracts/schema';

type ErrorResponse = components['schemas']['ErrorResponse'];
type ApproveTaskSuggestionRequest = components['schemas']['ApproveTaskSuggestionRequest'];
type EditTaskSuggestionRequest = components['schemas']['EditTaskSuggestionRequest'];
type DismissTaskSuggestionRequest = components['schemas']['DismissTaskSuggestionRequest'];
type MergeTaskSuggestionRequest = components['schemas']['MergeTaskSuggestionRequest'];
type TaskSummaryPoint = components['schemas']['TaskSummaryPoint'];
type TaskPriority = components['schemas']['TaskPriority'];

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

function parseOptionalSummaryPoints(
  value: unknown,
  field: string,
):
  | { ok: true; value: TaskSummaryPoint[] | undefined }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > 20 || !value.every(isSummaryPoint)) {
    return fail(`${field} is invalid.`);
  }
  if (value.length < 1) {
    return fail(`${field} must contain between 1 and 20 points.`);
  }
  return { ok: true, value: value as TaskSummaryPoint[] };
}

export function parseApproveSuggestionBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: ApproveTaskSuggestionRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (body.acknowledgement !== 'suggestion_approved') {
    return fail('acknowledgement must be suggestion_approved.');
  }
  const summaryPoints = parseOptionalSummaryPoints(body.summaryPoints, 'summaryPoints');
  if (!summaryPoints.ok) {
    return summaryPoints;
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
      acknowledgement: 'suggestion_approved',
      summaryPoints: summaryPoints.value,
      recipientId: body.recipientId as string | undefined,
      dueAt: body.dueAt as string | undefined,
      priority: body.priority as TaskPriority | undefined,
    },
  };
}

export function parseEditSuggestionBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: EditTaskSuggestionRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  const summaryPoints = parseOptionalSummaryPoints(body.summaryPoints, 'summaryPoints');
  if (!summaryPoints.ok) {
    return summaryPoints;
  }
  if (
    body.proposedRecipientId !== undefined &&
    body.proposedRecipientId !== null &&
    typeof body.proposedRecipientId !== 'string'
  ) {
    return fail('proposedRecipientId must be a string or null.');
  }
  if (
    body.proposedDueAt !== undefined &&
    body.proposedDueAt !== null &&
    !isIsoDateTime(body.proposedDueAt)
  ) {
    return fail('proposedDueAt must be an ISO date-time or null.');
  }
  if (
    body.proposedPriority !== undefined &&
    !PRIORITIES.has(body.proposedPriority as TaskPriority)
  ) {
    return fail('proposedPriority is invalid.');
  }
  return {
    ok: true,
    value: {
      summaryPoints: summaryPoints.value,
      proposedRecipientId: body.proposedRecipientId as string | null | undefined,
      proposedDueAt: body.proposedDueAt as string | null | undefined,
      proposedPriority: body.proposedPriority as TaskPriority | undefined,
    },
  };
}

export function parseDismissSuggestionBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: DismissTaskSuggestionRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (body.reason !== undefined) {
    if (typeof body.reason !== 'string' || body.reason.length > 500) {
      return fail('reason must be a string of at most 500 characters.');
    }
  }
  return {
    ok: true,
    value: {
      reason: body.reason as string | undefined,
    },
  };
}

export function parseMergeSuggestionBody(
  body: Record<string, unknown>,
):
  | { ok: true; value: MergeTaskSuggestionRequest }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (
    typeof body.targetTaskId !== 'string' ||
    !body.targetTaskId ||
    body.targetTaskId.length > 64
  ) {
    return fail('targetTaskId is invalid.');
  }
  if (body.appendSummaryPoints !== undefined && typeof body.appendSummaryPoints !== 'boolean') {
    return fail('appendSummaryPoints must be a boolean.');
  }
  return {
    ok: true,
    value: {
      targetTaskId: body.targetTaskId,
      targetTaskIfMatch: typeof body.targetTaskIfMatch === 'string' ? body.targetTaskIfMatch : '',
      appendSummaryPoints:
        body.appendSummaryPoints === undefined ? true : (body.appendSummaryPoints as boolean),
    },
  };
}
