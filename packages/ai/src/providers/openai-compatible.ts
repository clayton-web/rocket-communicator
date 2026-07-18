import { buildInvalidOutputFingerprint } from '../diagnostics.js';
import { AiProviderError } from '../errors.js';
import type {
  SuggestionExtractionInput,
  SuggestionExtractionProvider,
  SuggestionExtractionResult,
} from '../types.js';
import { DEFAULT_SUGGESTION_POLICY_VERSION } from '../types.js';
import {
  looksLikeProsePolicyRefusal,
  parseAndValidateExtractionOutput,
  parseModelJsonText,
} from '../validate.js';

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Max completion tokens (bounds runaway output). */
  maxTokens?: number;
  /** Soft input truncation for subject/snippet/excerpt. */
  maxInputChars?: number;
  policyVersion?: string;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

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

function truncateField(value: string | null, maxChars: number): string | null {
  if (value == null) {
    return null;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function readProviderErrorBody(text: string): {
  type: string | null;
  code: string | null;
} {
  try {
    const parsed = JSON.parse(text) as {
      error?: { type?: unknown; code?: unknown };
    };
    const type = typeof parsed.error?.type === 'string' ? parsed.error.type : null;
    const code = typeof parsed.error?.code === 'string' ? parsed.error.code : null;
    return { type, code };
  } catch {
    return { type: null, code: null };
  }
}

/**
 * OpenAI-compatible Chat Completions adapter (fetch-based; no SDK).
 * Sends only minimized event/excerpt fields — never OAuth or tokens.
 */
export class OpenAiCompatibleSuggestionProvider implements SuggestionExtractionProvider {
  readonly name = 'openai-compatible';
  private readonly config: Required<
    Pick<
      OpenAiCompatibleConfig,
      'apiKey' | 'model' | 'timeoutMs' | 'policyVersion' | 'maxTokens' | 'maxInputChars'
    >
  > &
    Pick<OpenAiCompatibleConfig, 'baseUrl' | 'fetchImpl'>;

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.apiKey) {
      throw new AiProviderError(
        'AI_MISSING_CREDENTIALS',
        'configuration',
        'AI credentials are not configured.',
      );
    }
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs ?? 25_000,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      maxInputChars: config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS,
      policyVersion: config.policyVersion ?? DEFAULT_SUGGESTION_POLICY_VERSION,
      fetchImpl: config.fetchImpl,
    };
  }

  async extract(input: SuggestionExtractionInput): Promise<SuggestionExtractionResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const base = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const maxChars = this.config.maxInputChars;

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You extract structured task-suggestion fields from minimized communication metadata. ' +
                EXTRACTION_SCHEMA_INSTRUCTION,
            },
            {
              role: 'user',
              content: JSON.stringify({
                subject: truncateField(input.subject, Math.min(500, maxChars)),
                snippet: truncateField(input.snippet, Math.min(1000, maxChars)),
                fromAddress: input.fromAddress,
                toAddresses: input.toAddresses,
                internalDate: input.internalDate,
                excerptContent: truncateField(input.excerptContent, maxChars),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        const bodyText = await response.text().catch(() => '');
        const { type, code } = readProviderErrorBody(bodyText);
        const fingerprint = buildInvalidOutputFingerprint({
          providerStatus: 429,
          providerErrorType: type,
          providerErrorCode: code,
          contentPresent: false,
          contentLength: 0,
          model: this.config.model,
          policyVersion: this.config.policyVersion,
        });
        if (
          code === 'insufficient_quota' ||
          type === 'insufficient_quota' ||
          /insufficient.?quota/i.test(bodyText)
        ) {
          throw new AiProviderError(
            'AI_INSUFFICIENT_QUOTA',
            'retryable',
            'AI provider quota exhausted.',
            fingerprint,
          );
        }
        throw new AiProviderError(
          'AI_RATE_LIMIT',
          'retryable',
          'AI provider rate limited.',
          fingerprint,
        );
      }
      if (response.status >= 500) {
        throw new AiProviderError(
          'AI_PROVIDER_5XX',
          'retryable',
          'AI provider server error.',
          buildInvalidOutputFingerprint({
            providerStatus: response.status,
            contentPresent: false,
            contentLength: 0,
            model: this.config.model,
          }),
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError(
          'AI_INVALID_CREDENTIALS',
          'configuration',
          'AI provider rejected credentials.',
          buildInvalidOutputFingerprint({
            providerStatus: response.status,
            contentPresent: false,
            contentLength: 0,
            model: this.config.model,
          }),
        );
      }
      if (!response.ok) {
        throw new AiProviderError(
          'AI_NETWORK',
          'retryable',
          'AI provider returned an unexpected status.',
          buildInvalidOutputFingerprint({
            providerStatus: response.status,
            contentPresent: false,
            contentLength: 0,
            model: this.config.model,
          }),
        );
      }

      const payload = (await response.json()) as {
        id?: string;
        choices?: Array<{
          finish_reason?: string | null;
          message?: { content?: string | null; refusal?: string | null };
        }>;
        model?: string;
      };

      const choice = payload.choices?.[0];
      if (!choice) {
        throw new AiProviderError(
          'AI_UNSUPPORTED_RESPONSE',
          'retryable',
          'AI provider returned no choices.',
          buildInvalidOutputFingerprint({
            providerStatus: 200,
            contentPresent: false,
            contentLength: 0,
            schemaIssueCodes: ['no_choices'],
            model: typeof payload.model === 'string' ? payload.model : this.config.model,
            requestId: typeof payload.id === 'string' ? payload.id : null,
          }),
        );
      }

      const finishReason = choice.finish_reason ?? null;
      const refusal = choice.message?.refusal;
      if (typeof refusal === 'string' && refusal.length > 0) {
        throw new AiProviderError(
          'AI_POLICY_REFUSAL',
          'permanent',
          'AI provider refused the request.',
          buildInvalidOutputFingerprint({
            providerStatus: 200,
            finishReason,
            contentPresent: false,
            contentLength: 0,
            schemaIssueCodes: ['provider_refusal_field'],
            model: typeof payload.model === 'string' ? payload.model : this.config.model,
            requestId: typeof payload.id === 'string' ? payload.id : null,
          }),
        );
      }

      const content = choice.message?.content;
      if (typeof content !== 'string') {
        throw new AiProviderError(
          'AI_EMPTY_OUTPUT',
          'retryable',
          'AI provider returned no message content.',
          buildInvalidOutputFingerprint({
            providerStatus: 200,
            finishReason,
            contentPresent: false,
            contentLength: 0,
            schemaIssueCodes: ['null_content'],
            model: typeof payload.model === 'string' ? payload.model : this.config.model,
            requestId: typeof payload.id === 'string' ? payload.id : null,
          }),
        );
      }

      // Content-based refusal only for non-JSON prose (never after valid JSON object).
      if (looksLikeProsePolicyRefusal(content)) {
        throw new AiProviderError(
          'AI_POLICY_REFUSAL',
          'permanent',
          'AI provider refused the request.',
          buildInvalidOutputFingerprint({
            providerStatus: 200,
            finishReason,
            contentPresent: true,
            contentLength: content.length,
            schemaIssueCodes: ['prose_refusal'],
            model: typeof payload.model === 'string' ? payload.model : this.config.model,
            requestId: typeof payload.id === 'string' ? payload.id : null,
          }),
        );
      }

      const parsed = parseModelJsonText(content);
      return parseAndValidateExtractionOutput(parsed, {
        policyVersion: this.config.policyVersion,
        modelVersion: typeof payload.model === 'string' ? payload.model : this.config.model,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || /aborted|timeout/i.test(error.message))
      ) {
        throw new AiProviderError('AI_TIMEOUT', 'retryable', 'AI provider request timed out.');
      }
      throw new AiProviderError('AI_NETWORK', 'retryable', 'AI provider network failure.');
    } finally {
      clearTimeout(timer);
    }
  }
}
