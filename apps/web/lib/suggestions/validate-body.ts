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
type ResponsibilitySelection = components['schemas']['ResponsibilitySelection'];
type ResponsiblePartyKind = components['schemas']['ResponsiblePartyKind'];

const PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high', 'urgent']);

const RESPONSIBLE_PARTIES = new Set<ResponsiblePartyKind>(['owner', 'recipient']);

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

/**
 * Validates the required D168 responsibility selection on approve.
 *
 * Required, not optional: every successful acceptance must carry affirmative evidence of the
 * Owner's initial responsibility choice, so an omitted selection is rejected rather than defaulted
 * or inferred to Owner. Absence of a selection is never evidence that the Owner selected Me
 * (D155, D164).
 *
 * `responsibleParty` carries the whole affirmative answer, so it is required whenever the object is
 * present: an Owner selection is never inferred from a missing Recipient. The two shapes are
 * mutually exclusive — a Recipient selection must name its Recipient, and an Owner selection must
 * not carry a `recipientId` key at all, matching how create-task rejects `recipientId` on presence
 * rather than on truthiness (D091 precedent).
 *
 * This is deliberately not the legacy top-level `recipientId`, which keeps its D080
 * `RECIPIENT_HANDOFF_NOT_AVAILABLE` rejection.
 */
function parseResponsibilitySelection(
  value: unknown,
):
  | { ok: true; value: ResponsibilitySelection }
  | { ok: false; response: NextResponse<ErrorResponse> } {
  if (value === undefined) {
    return fail('responsibility is required and must select owner or recipient.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('responsibility must be an object.');
  }
  const selection = value as Record<string, unknown>;
  if (!RESPONSIBLE_PARTIES.has(selection.responsibleParty as ResponsiblePartyKind)) {
    return fail('responsibility.responsibleParty must be owner or recipient.');
  }
  const responsibleParty = selection.responsibleParty as ResponsiblePartyKind;
  const hasRecipientId = Object.prototype.hasOwnProperty.call(selection, 'recipientId');
  if (responsibleParty === 'owner') {
    if (hasRecipientId) {
      return fail('responsibility.recipientId must be omitted when responsibleParty is owner.');
    }
    return { ok: true, value: { responsibleParty } };
  }
  if (
    typeof selection.recipientId !== 'string' ||
    selection.recipientId.length < 1 ||
    selection.recipientId.length > 64
  ) {
    return fail('responsibility.recipientId is required when responsibleParty is recipient.');
  }
  return { ok: true, value: { responsibleParty, recipientId: selection.recipientId } };
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
  // Required (D168): approve cannot succeed without an affirmative responsibility selection.
  const responsibility = parseResponsibilitySelection(body.responsibility);
  if (!responsibility.ok) {
    return responsibility;
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
      responsibility: responsibility.value,
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
