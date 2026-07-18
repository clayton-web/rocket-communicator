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
  /** Informational extraction field only in A6 — not persisted to proposedRecipientId; A7 handoff. */
  proposedRecipientHint?: string | null;
  policyVersion: string;
  modelVersion: string;
}

export type AiProviderErrorCode =
  | 'AI_DISABLED'
  | 'AI_MISSING_CREDENTIALS'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMIT'
  | 'AI_PROVIDER_5XX'
  | 'AI_NETWORK'
  | 'AI_INVALID_OUTPUT'
  | 'AI_POLICY_REFUSAL'
  | 'AI_EMPTY_OUTPUT';

export type AiProviderErrorKind = 'configuration' | 'retryable' | 'permanent';

export interface SuggestionExtractionProvider {
  readonly name: string;
  extract(input: SuggestionExtractionInput): Promise<SuggestionExtractionResult>;
}

export const DEFAULT_SUGGESTION_POLICY_VERSION = 'a6-suggestion-v1';
