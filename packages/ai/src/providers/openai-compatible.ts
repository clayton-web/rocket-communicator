import { AiProviderError } from '../errors.js';
import type {
  SuggestionExtractionInput,
  SuggestionExtractionProvider,
  SuggestionExtractionResult,
} from '../types.js';
import { DEFAULT_SUGGESTION_POLICY_VERSION } from '../types.js';
import { parseAndValidateExtractionOutput, parseModelJsonText } from '../validate.js';

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  policyVersion?: string;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

const EXTRACTION_SCHEMA_INSTRUCTION = `Return ONLY a JSON object with this shape (no markdown):
{
  "summaryPoints": [ /* 1-20 TaskSummaryPoint objects with id, kind, label, order, and kind-specific fields */ ],
  "proposedDueAt": string|null,
  "proposedPriority": "low"|"normal"|"high"|"urgent"|null,
  "proposedRecipientHint": string|null,
  "policyVersion": string,
  "modelVersion": string
}
Kinds: confirmed_fact|request|commitment|amount|deadline|risk|inference|missing_information|next_action.
Do not invent facts not supported by the input. Do not include raw email headers beyond the provided fields.`;

/**
 * OpenAI-compatible Chat Completions adapter (fetch-based; no SDK).
 * Sends only minimized event/excerpt fields — never OAuth or tokens.
 */
export class OpenAiCompatibleSuggestionProvider implements SuggestionExtractionProvider {
  readonly name = 'openai-compatible';
  private readonly config: Required<
    Pick<OpenAiCompatibleConfig, 'apiKey' | 'model' | 'timeoutMs' | 'policyVersion'>
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
                subject: input.subject,
                snippet: input.snippet,
                fromAddress: input.fromAddress,
                toAddresses: input.toAddresses,
                internalDate: input.internalDate,
                excerptContent: input.excerptContent,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new AiProviderError('AI_RATE_LIMIT', 'retryable', 'AI provider rate limited.');
      }
      if (response.status >= 500) {
        throw new AiProviderError('AI_PROVIDER_5XX', 'retryable', 'AI provider server error.');
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError(
          'AI_MISSING_CREDENTIALS',
          'configuration',
          'AI provider rejected credentials.',
        );
      }
      if (!response.ok) {
        throw new AiProviderError(
          'AI_NETWORK',
          'retryable',
          'AI provider returned an unexpected status.',
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
        model?: string;
      };

      const choice = payload.choices?.[0];
      const refusal = choice?.message?.refusal;
      if (typeof refusal === 'string' && refusal.length > 0) {
        throw new AiProviderError(
          'AI_POLICY_REFUSAL',
          'permanent',
          'AI provider refused the request.',
        );
      }

      const content = choice?.message?.content;
      if (typeof content !== 'string') {
        throw new AiProviderError(
          'AI_EMPTY_OUTPUT',
          'retryable',
          'AI provider returned no message content.',
        );
      }

      // Detect common refusal phrasing without storing the content.
      if (/i\s+can'?t\s+assist|i\s+cannot\s+assist|against\s+my\s+guidelines/i.test(content)) {
        throw new AiProviderError(
          'AI_POLICY_REFUSAL',
          'permanent',
          'AI provider refused the request.',
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
