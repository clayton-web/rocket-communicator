import {
  MAX_LABEL_LENGTH,
  MAX_SUMMARY_POINTS,
  MAX_TEXT_VALUE_LENGTH,
  type TaskSummaryPoint,
  validateSummaryPoints,
} from '@aicaa/domain';
import { buildInvalidOutputFingerprint } from './diagnostics.js';
import { AiProviderError } from './errors.js';

const TEXT_KINDS = new Set(['confirmed_fact', 'request', 'commitment', 'risk', 'next_action']);

/** Harmless transport aliases for text-kind `value` (models often emit these). */
const VALUE_ALIASES = ['value', 'details', 'text', 'content', 'description'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function schemaError(
  issueCode: string,
  message: string,
  extras?: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): AiProviderError {
  const fingerprint = buildInvalidOutputFingerprint({
    contentPresent: true,
    contentLength: 0,
    topLevelKeys: extras?.topLevelKeys,
    schemaIssueCodes: [issueCode],
    model: extras?.model,
    policyVersion: extras?.policyVersion,
  });
  return new AiProviderError('AI_SCHEMA_INVALID', 'retryable', message, fingerprint);
}

export function requireString(value: unknown, field: string, issueCode: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw schemaError(issueCode, `Structured output field ${field} must be a non-empty string.`);
  }
  return value;
}

/**
 * Accept string ids, or coerce finite numbers / booleans to string (transport only).
 * Does not invent missing ids.
 */
export function requirePointId(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw schemaError(
    'point_id_invalid',
    `Structured output field ${field} must be a non-empty string.`,
  );
}

export function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw schemaError(
      'optional_string_invalid',
      `Structured output field ${field} must be a string or null.`,
    );
  }
  return value;
}

function resolveTextValue(entry: Record<string, unknown>, index: number): string {
  for (const key of VALUE_ALIASES) {
    const candidate = entry[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  throw schemaError(
    'point_value_missing',
    `summaryPoints[${index}].value must be a non-empty string.`,
  );
}

export function parseSummaryPoint(entry: unknown, index: number): TaskSummaryPoint {
  if (!isRecord(entry)) {
    throw schemaError('point_not_object', `summaryPoints[${index}] must be an object.`);
  }

  const id = requirePointId(entry.id, `summaryPoints[${index}].id`);
  const kind = requireString(entry.kind, `summaryPoints[${index}].kind`, 'point_kind_invalid');
  const label = requireString(entry.label, `summaryPoints[${index}].label`, 'point_label_invalid');
  if (label.length > MAX_LABEL_LENGTH) {
    throw schemaError(
      'point_label_too_long',
      `summaryPoints[${index}].label exceeds maximum length.`,
    );
  }

  if (typeof entry.order !== 'number' || !Number.isInteger(entry.order)) {
    throw schemaError('point_order_invalid', `summaryPoints[${index}].order must be an integer.`);
  }
  const order = entry.order;

  if (TEXT_KINDS.has(kind)) {
    const value = resolveTextValue(entry, index);
    if (value.length > MAX_TEXT_VALUE_LENGTH) {
      throw schemaError(
        'point_value_too_long',
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
    const value = resolveTextValue(entry, index);
    if (typeof entry.confidence !== 'number') {
      throw schemaError(
        'point_confidence_invalid',
        `summaryPoints[${index}].confidence must be a number.`,
      );
    }
    return { id, kind: 'inference', label, order, value, confidence: entry.confidence };
  }

  if (kind === 'missing_information') {
    const missingItem = requireString(
      entry.missingItem,
      `summaryPoints[${index}].missingItem`,
      'point_missing_item_invalid',
    );
    return { id, kind: 'missing_information', label, order, missingItem };
  }

  if (kind === 'amount') {
    if (typeof entry.amount !== 'number') {
      throw schemaError('point_amount_invalid', `summaryPoints[${index}].amount must be a number.`);
    }
    const currency = requireString(
      entry.currency,
      `summaryPoints[${index}].currency`,
      'point_currency_invalid',
    );
    return { id, kind: 'amount', label, order, amount: entry.amount, currency };
  }

  if (kind === 'deadline') {
    const dueAt = optionalNullableString(entry.dueAt, `summaryPoints[${index}].dueAt`) ?? undefined;
    const localDate =
      optionalNullableString(entry.localDate, `summaryPoints[${index}].localDate`) ?? undefined;
    const timezone =
      optionalNullableString(entry.timezone, `summaryPoints[${index}].timezone`) ?? undefined;
    // Tolerate dueDate alias → dueAt (ISO) or localDate when YYYY-MM-DD-shaped.
    let resolvedDueAt = dueAt;
    let resolvedLocalDate = localDate;
    if (!resolvedDueAt && !resolvedLocalDate && typeof entry.dueDate === 'string') {
      const dueDate = entry.dueDate.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        resolvedLocalDate = dueDate;
      } else if (dueDate.length > 0) {
        resolvedDueAt = dueDate;
      }
    }
    return {
      id,
      kind: 'deadline',
      label,
      order,
      ...(resolvedDueAt ? { dueAt: resolvedDueAt } : {}),
      ...(resolvedLocalDate ? { localDate: resolvedLocalDate } : {}),
      ...(timezone ? { timezone } : {}),
    };
  }

  throw schemaError('point_kind_unsupported', `summaryPoints[${index}].kind is unsupported.`);
}

/**
 * Parse and domain-validate a summaryPoints array.
 * Caller decides empty-array semantics (A6 empty → AI_EMPTY_OUTPUT; interpretation per-task empty → schema invalid).
 */
export function parseSummaryPointsArray(
  rawPoints: unknown[],
  extras?: { topLevelKeys?: string[]; model?: string; policyVersion?: string },
): TaskSummaryPoint[] {
  if (rawPoints.length > MAX_SUMMARY_POINTS) {
    throw schemaError(
      'summary_points_too_many',
      `Structured output exceeds ${MAX_SUMMARY_POINTS} summary points.`,
      extras,
    );
  }

  const summaryPoints: TaskSummaryPoint[] = [];
  for (const [index, entry] of rawPoints.entries()) {
    summaryPoints.push(parseSummaryPoint(entry, index));
  }

  try {
    validateSummaryPoints(summaryPoints);
  } catch {
    throw schemaError(
      'domain_validate_failed',
      'Structured output failed domain summary-point validation.',
      extras,
    );
  }

  return summaryPoints;
}
