import type {
  SuggestionExtractionInput,
  SuggestionExtractionProvider,
  SuggestionExtractionResult,
} from '../types.js';
import { DEFAULT_SUGGESTION_POLICY_VERSION } from '../types.js';
import { parseAndValidateExtractionOutput } from '../validate.js';
import {
  completeOpenAiCompatibleJsonObject,
  resolveOpenAiCompatibleTransportConfig,
  truncateField,
  type OpenAiCompatibleTransportConfig,
  type ResolvedOpenAiCompatibleTransportConfig,
} from './openai-compatible-transport.js';

export type OpenAiCompatibleConfig = OpenAiCompatibleTransportConfig;

/**
 * Explicit TaskSummaryPoint contract matching domain validation.
 * Prefer this over vague "kind-specific fields" so models emit `value` and string `id`.
 */
export const EXTRACTION_SCHEMA_INSTRUCTION = `Return ONLY a JSON object (no markdown fences, no prose) with this exact shape:
{
  "summaryPoints": [ /* 1-20 points */ ],
  "proposedDueAt": string|null,
  "proposedPriority": "low"|"normal"|"high"|"urgent"|null,
  "proposedRecipientHint": string|null
}

Each summaryPoints entry MUST include:
- "id": string (never a number; e.g. "sp_1")
- "kind": one of confirmed_fact|request|commitment|amount|deadline|risk|inference|missing_information|next_action
- "label": string (max 120 chars)
- "order": integer (0-based)

Kind-specific REQUIRED fields:
- confirmed_fact|request|commitment|risk|next_action: "value" (string, max 500) — use "value", NOT "details"/"text"
- inference: "value" (string) AND "confidence" (number 0-1)
- missing_information: "missingItem" (string)
- amount: "amount" (number) AND "currency" (string, e.g. "USD")
- deadline: optional "dueAt" (ISO-8601) and/or "localDate" (YYYY-MM-DD) and/or "timezone"

Example actionable point:
{"id":"sp_1","kind":"request","label":"Call tenant","order":0,"value":"Call the tenant tomorrow and confirm access for Friday."}

Extract only actionable content supported by the input. Prefer request/next_action/commitment points when the message asks for work.
Do not invent facts, deadlines, amounts, or contacts not supported by the input. Do not include raw email headers beyond the provided fields.`;

const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_MAX_INPUT_CHARS = 4000;

/**
 * OpenAI-compatible Chat Completions adapter (fetch-based; no SDK).
 * Sends only minimized event/excerpt fields — never OAuth or tokens.
 */
export class OpenAiCompatibleSuggestionProvider implements SuggestionExtractionProvider {
  readonly name = 'openai-compatible';
  private readonly config: ResolvedOpenAiCompatibleTransportConfig;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = resolveOpenAiCompatibleTransportConfig(config, {
      maxTokens: DEFAULT_MAX_TOKENS,
      maxInputChars: DEFAULT_MAX_INPUT_CHARS,
      policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION,
    });
  }

  async extract(input: SuggestionExtractionInput): Promise<SuggestionExtractionResult> {
    const maxChars = this.config.maxInputChars;
    const { parsed, modelVersion } = await completeOpenAiCompatibleJsonObject({
      config: this.config,
      systemContent:
        'You extract structured task-suggestion fields from minimized communication metadata. ' +
        EXTRACTION_SCHEMA_INSTRUCTION,
      userContent: JSON.stringify({
        subject: truncateField(input.subject, Math.min(500, maxChars)),
        snippet: truncateField(input.snippet, Math.min(1000, maxChars)),
        fromAddress: input.fromAddress,
        toAddresses: input.toAddresses,
        internalDate: input.internalDate,
        excerptContent: truncateField(input.excerptContent, maxChars),
      }),
    });

    return parseAndValidateExtractionOutput(parsed, {
      policyVersion: this.config.policyVersion,
      modelVersion,
    });
  }
}
