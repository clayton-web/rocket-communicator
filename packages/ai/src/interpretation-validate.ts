import type { TaskSummaryPoint } from '@aicaa/domain';
import {
  isRecord,
  optionalNullableString,
  parseSummaryPointsArray,
  schemaError,
} from './summary-point-parse.js';
import type { InterpretationResult, ProposedTask } from './types.js';
import {
  MAX_DEADLINE_EXPRESSION_LENGTH,
  MAX_PEOPLE_HINT_LENGTH,
  MAX_PEOPLE_HINTS,
  MAX_PROPOSED_TASKS,
} from './types.js';

/** Kinds that count as actionable content for a proposed task. */
const ACTIONABLE_KINDS = new Set(['request', 'commitment', 'next_action']);

/**
 * Validate raw provider JSON into an InterpretationResult.
 *
 * Semantics differ from A6 extraction:
 * - tasks: [] is a successful empty interpretation (not AI_EMPTY_OUTPUT).
 * - A claimed task with empty/non-actionable summaryPoints is AI_SCHEMA_INVALID.
 */
export function parseAndValidateInterpretationOutput(
  raw: unknown,
  defaults: { policyVersion: string; modelVersion: string },
): InterpretationResult {
  if (!isRecord(raw)) {
    throw schemaError('root_not_object', 'Structured output must be a JSON object.');
  }

  const topLevelKeys = Object.keys(raw);
  const extras = {
    topLevelKeys,
    model: defaults.modelVersion,
    policyVersion: defaults.policyVersion,
  };

  if (!Array.isArray(raw.tasks)) {
    throw schemaError('tasks_missing', 'Structured output requires tasks array.', extras);
  }

  if (raw.tasks.length > MAX_PROPOSED_TASKS) {
    throw schemaError(
      'tasks_too_many',
      `Structured output exceeds ${MAX_PROPOSED_TASKS} proposed tasks.`,
      extras,
    );
  }

  const tasks: ProposedTask[] = [];
  for (const [taskIndex, entry] of raw.tasks.entries()) {
    tasks.push(parseProposedTask(entry, taskIndex, extras));
  }

  const policyVersion =
    typeof raw.policyVersion === 'string' && raw.policyVersion.length > 0
      ? raw.policyVersion
      : defaults.policyVersion;
  const modelVersion =
    typeof raw.modelVersion === 'string' && raw.modelVersion.length > 0
      ? raw.modelVersion
      : defaults.modelVersion;

  return {
    tasks,
    policyVersion,
    modelVersion,
  };
}

function parseProposedTask(
  entry: unknown,
  taskIndex: number,
  extras: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): ProposedTask {
  if (!isRecord(entry)) {
    throw schemaError(
      'task_not_object',
      `tasks[${taskIndex}] must be an object.`,
      extras,
    );
  }

  if (!Array.isArray(entry.summaryPoints)) {
    throw schemaError(
      'task_summary_points_missing',
      `tasks[${taskIndex}].summaryPoints must be an array.`,
      extras,
    );
  }

  // Claimed task with no points is schema-invalid — not successful empty interpretation.
  if (entry.summaryPoints.length === 0) {
    throw schemaError(
      'task_summary_points_empty',
      `tasks[${taskIndex}] claims a task but summaryPoints is empty.`,
      extras,
    );
  }

  const summaryPoints = parseSummaryPointsArray(entry.summaryPoints, extras);
  assertHasActionableContent(summaryPoints, taskIndex, extras);

  const peopleHints = parsePeopleHints(entry.peopleHints, taskIndex, extras);
  const deadlineExpression = parseDeadlineExpression(
    entry.deadlineExpression,
    taskIndex,
    extras,
  );

  return {
    summaryPoints,
    peopleHints,
    deadlineExpression,
  };
}

function assertHasActionableContent(
  summaryPoints: TaskSummaryPoint[],
  taskIndex: number,
  extras: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): void {
  const hasActionable = summaryPoints.some((point) => ACTIONABLE_KINDS.has(point.kind));
  if (!hasActionable) {
    throw schemaError(
      'task_not_actionable',
      `tasks[${taskIndex}] must include at least one request, commitment, or next_action point.`,
      extras,
    );
  }
}

function parsePeopleHints(
  raw: unknown,
  taskIndex: number,
  extras: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): string[] {
  // Default missing to [] for transport resilience; do not invent names.
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw schemaError(
      'people_hints_invalid',
      `tasks[${taskIndex}].peopleHints must be an array.`,
      extras,
    );
  }
  if (raw.length > MAX_PEOPLE_HINTS) {
    throw schemaError(
      'people_hints_too_many',
      `tasks[${taskIndex}].peopleHints exceeds ${MAX_PEOPLE_HINTS}.`,
      extras,
    );
  }

  const hints: string[] = [];
  for (const [index, value] of raw.entries()) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw schemaError(
        'people_hint_invalid',
        `tasks[${taskIndex}].peopleHints[${index}] must be a non-empty string.`,
        extras,
      );
    }
    const hint = value.trim();
    if (hint.length > MAX_PEOPLE_HINT_LENGTH) {
      throw schemaError(
        'people_hint_too_long',
        `tasks[${taskIndex}].peopleHints[${index}] exceeds maximum length.`,
        extras,
      );
    }
    // Hints are names only — reject email-shaped invention at validation boundary.
    if (hint.includes('@')) {
      throw schemaError(
        'people_hint_email_forbidden',
        `tasks[${taskIndex}].peopleHints[${index}] must not be an email address.`,
        extras,
      );
    }
    hints.push(hint);
  }
  return hints;
}

function parseDeadlineExpression(
  raw: unknown,
  taskIndex: number,
  extras: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): string | null {
  const value = optionalNullableString(
    raw,
    `tasks[${taskIndex}].deadlineExpression`,
  );
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_DEADLINE_EXPRESSION_LENGTH) {
    throw schemaError(
      'deadline_expression_too_long',
      `tasks[${taskIndex}].deadlineExpression exceeds maximum length.`,
      extras,
    );
  }
  return trimmed;
}
