import { buildInvalidOutputFingerprint } from './diagnostics.js';
import { AiProviderError } from './errors.js';
import {
  isRecord,
  optionalNullableString,
  parseSummaryPointsArray,
  schemaError,
} from './summary-point-parse.js';
import type { SuggestionExtractionResult } from './types.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

/**
 * Validate raw provider JSON into a SuggestionExtractionResult.
 * Tolerates only harmless transport coercions (numeric id → string, value aliases).
 * Does not invent domain facts or repair empty summaryPoints.
 *
 * A6 semantics: empty summaryPoints is AI_EMPTY_OUTPUT (not a successful empty interpretation).
 */
export function parseAndValidateExtractionOutput(
  raw: unknown,
  defaults: { policyVersion: string; modelVersion: string },
): SuggestionExtractionResult {
  if (!isRecord(raw)) {
    throw schemaError('root_not_object', 'Structured output must be a JSON object.');
  }

  const topLevelKeys = Object.keys(raw);
  const extras = {
    topLevelKeys,
    model: defaults.modelVersion,
    policyVersion: defaults.policyVersion,
  };

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

  const summaryPoints = parseSummaryPointsArray(raw.summaryPoints, extras);

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
