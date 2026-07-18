import {
  MAX_LABEL_LENGTH,
  MAX_SUMMARY_POINTS,
  MAX_TEXT_VALUE_LENGTH,
  type TaskSummaryPoint,
  validateSummaryPoints,
} from '@aicaa/domain';
import { buildInvalidOutputFingerprint } from './diagnostics.js';
import { AiProviderError } from './errors.js';
import type { SuggestionExtractionResult } from './types.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const TEXT_KINDS = new Set(['confirmed_fact', 'request', 'commitment', 'risk', 'next_action']);

/** Harmless transport aliases for text-kind `value` (models often emit these). */
const VALUE_ALIASES = ['value', 'details', 'text', 'content', 'description'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaError(
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

function requireString(value: unknown, field: string, issueCode: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw schemaError(issueCode, `Structured output field ${field} must be a non-empty string.`);
  }
  return value;
}

/**
 * Accept string ids, or coerce finite numbers / booleans to string (transport only).
 * Does not invent missing ids.
 */
function requirePointId(value: unknown, field: string): string {
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

function optionalNullableString(value: unknown, field: string): string | null | undefined {
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

/**
 * Validate raw provider JSON into a SuggestionExtractionResult.
 * Tolerates only harmless transport coercions (numeric id → string, value aliases).
 * Does not invent domain facts or repair empty summaryPoints.
 */
export function parseAndValidateExtractionOutput(
  raw: unknown,
  defaults: { policyVersion: string; modelVersion: string },
): SuggestionExtractionResult {
  if (!isRecord(raw)) {
    throw schemaError('root_not_object', 'Structured output must be a JSON object.');
  }

  const topLevelKeys = Object.keys(raw);

  if (!Array.isArray(raw.summaryPoints)) {
    throw schemaError('summary_points_missing', 'Structured output requires summaryPoints array.', {
      topLevelKeys,
      model: defaults.modelVersion,
      policyVersion: defaults.policyVersion,
    });
  }

  if (raw.summaryPoints.length === 0) {
    throw new AiProviderError(
      'AI_EMPTY_OUTPUT',
      'retryable',
      'Structured output summaryPoints is empty.',
      buildInvalidOutputFingerprint({
        contentPresent: true,
        contentLength: 0,
        topLevelKeys,
        schemaIssueCodes: ['summary_points_empty'],
        model: defaults.modelVersion,
        policyVersion: defaults.policyVersion,
      }),
    );
  }

  if (raw.summaryPoints.length > MAX_SUMMARY_POINTS) {
    throw schemaError(
      'summary_points_too_many',
      `Structured output exceeds ${MAX_SUMMARY_POINTS} summary points.`,
      { topLevelKeys, model: defaults.modelVersion, policyVersion: defaults.policyVersion },
    );
  }

  const summaryPoints: TaskSummaryPoint[] = [];
  for (const [index, entry] of raw.summaryPoints.entries()) {
    summaryPoints.push(parseSummaryPoint(entry, index));
  }

  try {
    validateSummaryPoints(summaryPoints);
  } catch {
    throw schemaError(
      'domain_validate_failed',
      'Structured output failed domain summary-point validation.',
      {
        topLevelKeys,
        model: defaults.modelVersion,
        policyVersion: defaults.policyVersion,
      },
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
    throw schemaError(
      'proposed_priority_invalid',
      'Structured output proposedPriority is invalid.',
      {
        topLevelKeys,
        model: defaults.modelVersion,
        policyVersion: defaults.policyVersion,
      },
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

/** Strip optional Markdown JSON fences; does not invent content. */
export function stripMarkdownJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

/** Parse a JSON string from the model; never logs content. */
export function parseModelJsonText(text: string): unknown {
  const trimmed = stripMarkdownJsonFences(text);
  if (trimmed.length === 0) {
    throw new AiProviderError(
      'AI_EMPTY_OUTPUT',
      'retryable',
      'Model returned empty output.',
      buildInvalidOutputFingerprint({
        contentPresent: false,
        contentLength: 0,
        schemaIssueCodes: ['empty_text'],
      }),
    );
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new AiProviderError(
      'AI_MALFORMED_JSON',
      'retryable',
      'Model returned malformed JSON.',
      buildInvalidOutputFingerprint({
        contentPresent: true,
        contentLength: trimmed.length,
        schemaIssueCodes: ['json_parse_failed'],
      }),
    );
  }
}

/**
 * Narrow content-based refusal detector. Only for non-JSON prose refusals.
 * Must not match legitimate structured JSON (e.g. emails mentioning "cannot assist").
 */
export function looksLikeProsePolicyRefusal(content: string): boolean {
  const trimmed = stripMarkdownJsonFences(content);
  // If it parses as JSON object, never treat as prose refusal.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      return false;
    }
  } catch {
    // continue
  }
  return (
    /^\s*i\s+can'?t\s+assist\b/i.test(trimmed) ||
    /^\s*i\s+cannot\s+assist\b/i.test(trimmed) ||
    /^\s*i'?m\s+unable\s+to\s+(help|assist)\b/i.test(trimmed) ||
    /^\s*against\s+my\s+(programming|guidelines)\b/i.test(trimmed)
  );
}
