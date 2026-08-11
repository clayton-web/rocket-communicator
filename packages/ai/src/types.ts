import type { TaskSummaryPoint } from '@aicaa/domain';

/** Minimized event/excerpt payload for LLM extraction (D085, AI constitution). */
export interface SuggestionExtractionInput {
  organizationId: string;
  eventId: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  toAddresses: string[];
  internalDate: string;
  /** Temporary excerpt body when present and not purged; otherwise null. */
  excerptContent: string | null;
  excerptId: string | null;
}

export interface SuggestionExtractionResult {
  summaryPoints: TaskSummaryPoint[];
  proposedDueAt?: string | null;
  proposedPriority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  /** Informational only in A6 — never triggers handoff. */
  proposedRecipientHint?: string | null;
  policyVersion: string;
  modelVersion: string;
}

export type AiProviderErrorCode =
  | 'AI_DISABLED'
  | 'AI_MISSING_CREDENTIALS'
  | 'AI_INVALID_CREDENTIALS'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMIT'
  | 'AI_INSUFFICIENT_QUOTA'
  | 'AI_PROVIDER_5XX'
  | 'AI_NETWORK'
  | 'AI_INVALID_OUTPUT'
  | 'AI_MALFORMED_JSON'
  | 'AI_SCHEMA_INVALID'
  | 'AI_POLICY_REFUSAL'
  | 'AI_EMPTY_OUTPUT'
  | 'AI_UNSUPPORTED_RESPONSE';

export type AiProviderErrorKind = 'configuration' | 'retryable' | 'permanent';

export interface SuggestionExtractionProvider {
  readonly name: string;
  extract(input: SuggestionExtractionInput): Promise<SuggestionExtractionResult>;
}

export const DEFAULT_SUGGESTION_POLICY_VERSION = 'a6-suggestion-v1';

// ---------------------------------------------------------------------------
// Context-free interpretation contract (0..N proposed tasks)
// Distinct from A6 Gmail suggestion extraction — do not conflate semantics.
// ---------------------------------------------------------------------------

/** Maximum proposed tasks accepted from one interpretation call. */
export const MAX_PROPOSED_TASKS = 10;

/** Maximum people hints per proposed task. */
export const MAX_PEOPLE_HINTS = 10;

/** Maximum length of a single people hint. */
export const MAX_PEOPLE_HINT_LENGTH = 80;

/** Maximum length of a grounded deadline expression. */
export const MAX_DEADLINE_EXPRESSION_LENGTH = 200;

/**
 * Context-free interpretation input.
 * Must not include previous tasks, Owner edits, assignment/Recipient history,
 * prior communications, or inferred preferences.
 */
export interface InterpretationInput {
  /** Raw text to interpret. */
  rawInput: string;
  /** Source/capture timestamp when available (ISO-8601). Mechanical context only. */
  capturedAt?: string | null;
  /** Owner/org IANA timezone when available. Mechanical context only. */
  timezone?: string | null;
}

/**
 * One distinct actionable proposal.
 * Card heading is derived later from summaryPoints (no separate title field).
 * Does not create a Task; does not resolve Recipients; does not invent reminders.
 */
export interface ProposedTask {
  summaryPoints: TaskSummaryPoint[];
  /** Explicitly grounded person names from the input — not Recipient resolution. */
  peopleHints: string[];
  /** Explicitly grounded deadline phrasing from the input; not an absolute due timestamp. */
  deadlineExpression: string | null;
}

/**
 * Successful interpretation result.
 * `tasks: []` is a valid success (not AI_EMPTY_OUTPUT).
 */
export interface InterpretationResult {
  tasks: ProposedTask[];
  policyVersion: string;
  modelVersion: string;
}

export interface InterpretationProvider {
  readonly name: string;
  interpret(input: InterpretationInput): Promise<InterpretationResult>;
}

export const DEFAULT_INTERPRETATION_POLICY_VERSION = 'interpretation-v1';
