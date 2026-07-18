import {
  MAX_LABEL_LENGTH,
  MAX_SUMMARY_POINTS,
  MAX_TEXT_VALUE_LENGTH,
  type TaskSummaryPoint,
  validateSummaryPoints,
} from '@aicaa/domain';
import { AiProviderError } from './errors.js';
import type { SuggestionExtractionResult } from './types.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const TEXT_KINDS = new Set(['confirmed_fact', 'request', 'commitment', 'risk', 'next_action']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `Structured output field ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `Structured output field ${field} must be a string or null.`,
    );
  }
  return value;
}

/**
 * Validate raw provider JSON into a SuggestionExtractionResult.
 * Does not invent or repair missing fields — rejects invalid output.
 */
export function parseAndValidateExtractionOutput(
  raw: unknown,
  defaults: { policyVersion: string; modelVersion: string },
): SuggestionExtractionResult {
  if (!isRecord(raw)) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      'Structured output must be a JSON object.',
    );
  }

  if (!Array.isArray(raw.summaryPoints)) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      'Structured output requires summaryPoints array.',
    );
  }

  if (raw.summaryPoints.length === 0) {
    throw new AiProviderError(
      'AI_EMPTY_OUTPUT',
      'retryable',
      'Structured output summaryPoints is empty.',
    );
  }

  if (raw.summaryPoints.length > MAX_SUMMARY_POINTS) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `Structured output exceeds ${MAX_SUMMARY_POINTS} summary points.`,
    );
  }

  const summaryPoints: TaskSummaryPoint[] = [];
  for (const [index, entry] of raw.summaryPoints.entries()) {
    summaryPoints.push(parseSummaryPoint(entry, index));
  }

  try {
    validateSummaryPoints(summaryPoints);
  } catch {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      'Structured output failed domain summary-point validation.',
    );
  }

  const proposedPriorityRaw = optionalNullableString(raw.proposedPriority, 'proposedPriority');
  let proposedPriority: SuggestionExtractionResult['proposedPriority'];
  if (proposedPriorityRaw === undefined) {
    proposedPriority = undefined;
  } else if (proposedPriorityRaw === null) {
    proposedPriority = null;
  } else if (PRIORITIES.has(proposedPriorityRaw)) {
    proposedPriority = proposedPriorityRaw as NonNullable<
      SuggestionExtractionResult['proposedPriority']
    >;
  } else {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      'Structured output proposedPriority is invalid.',
    );
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
    summaryPoints,
    proposedDueAt: optionalNullableString(raw.proposedDueAt, 'proposedDueAt'),
    proposedPriority,
    proposedRecipientHint: optionalNullableString(
      raw.proposedRecipientHint,
      'proposedRecipientHint',
    ),
    policyVersion,
    modelVersion,
  };
}

function parseSummaryPoint(entry: unknown, index: number): TaskSummaryPoint {
  if (!isRecord(entry)) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `summaryPoints[${index}] must be an object.`,
    );
  }

  const id = requireString(entry.id, `summaryPoints[${index}].id`);
  const kind = requireString(entry.kind, `summaryPoints[${index}].kind`);
  const label = requireString(entry.label, `summaryPoints[${index}].label`);
  if (label.length > MAX_LABEL_LENGTH) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `summaryPoints[${index}].label exceeds maximum length.`,
    );
  }

  if (typeof entry.order !== 'number' || !Number.isInteger(entry.order)) {
    throw new AiProviderError(
      'AI_INVALID_OUTPUT',
      'retryable',
      `summaryPoints[${index}].order must be an integer.`,
    );
  }
  const order = entry.order;

  if (TEXT_KINDS.has(kind)) {
    const value = requireString(entry.value, `summaryPoints[${index}].value`);
    if (value.length > MAX_TEXT_VALUE_LENGTH) {
      throw new AiProviderError(
        'AI_INVALID_OUTPUT',
        'retryable',
        `summaryPoints[${index}].value exceeds maximum length.`,
      );
    }
    return {
      id,
      kind: kind as 'confirmed_fact' | 'request' | 'commitment' | 'risk' | 'next_action',
      label,
      order,
      value,
    };
  }

  if (kind === 'inference') {
    const value = requireString(entry.value, `summaryPoints[${index}].value`);
    if (typeof entry.confidence !== 'number') {
      throw new AiProviderError(
        'AI_INVALID_OUTPUT',
        'retryable',
        `summaryPoints[${index}].confidence must be a number.`,
      );
    }
    return { id, kind: 'inference', label, order, value, confidence: entry.confidence };
  }

  if (kind === 'missing_information') {
    const missingItem = requireString(entry.missingItem, `summaryPoints[${index}].missingItem`);
    return { id, kind: 'missing_information', label, order, missingItem };
  }

  if (kind === 'amount') {
    if (typeof entry.amount !== 'number') {
      throw new AiProviderError(
        'AI_INVALID_OUTPUT',
        'retryable',
        `summaryPoints[${index}].amount must be a number.`,
      );
    }
    const currency = requireString(entry.currency, `summaryPoints[${index}].currency`);
    return { id, kind: 'amount', label, order, amount: entry.amount, currency };
  }

  if (kind === 'deadline') {
    const dueAt = optionalNullableString(entry.dueAt, `summaryPoints[${index}].dueAt`) ?? undefined;
    const localDate =
      optionalNullableString(entry.localDate, `summaryPoints[${index}].localDate`) ?? undefined;
    const timezone =
      optionalNullableString(entry.timezone, `summaryPoints[${index}].timezone`) ?? undefined;
    return {
      id,
      kind: 'deadline',
      label,
      order,
      ...(dueAt ? { dueAt } : {}),
      ...(localDate ? { localDate } : {}),
      ...(timezone ? { timezone } : {}),
    };
  }

  throw new AiProviderError(
    'AI_INVALID_OUTPUT',
    'retryable',
    `summaryPoints[${index}].kind is unsupported.`,
  );
}

/** Parse a JSON string from the model; never logs content. */
export function parseModelJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AiProviderError('AI_EMPTY_OUTPUT', 'retryable', 'Model returned empty output.');
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new AiProviderError('AI_INVALID_OUTPUT', 'retryable', 'Model returned malformed JSON.');
  }
}
