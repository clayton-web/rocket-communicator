import { buildInvalidOutputFingerprint } from '../diagnostics.js';
import { AiProviderError } from '../errors.js';
import { looksLikeProsePolicyRefusal, parseModelJsonText } from '../validate.js';

/** Shared OpenAI-compatible Chat Completions transport config. */
export interface OpenAiCompatibleTransportConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Max completion tokens (bounds runaway output). */
  maxTokens?: number;
  /** Soft input truncation bound. */
  maxInputChars?: number;
  policyVersion?: string;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

export type ResolvedOpenAiCompatibleTransportConfig = Required<
  Pick<
    OpenAiCompatibleTransportConfig,
    'apiKey' | 'model' | 'timeoutMs' | 'policyVersion' | 'maxTokens' | 'maxInputChars'
  >
> &
  Pick<OpenAiCompatibleTransportConfig, 'baseUrl' | 'fetchImpl'>;

export function resolveOpenAiCompatibleTransportConfig(
  config: OpenAiCompatibleTransportConfig,
  defaults: { maxTokens: number; maxInputChars: number; policyVersion: string },
): ResolvedOpenAiCompatibleTransportConfig {
  if (!config.apiKey) {
    throw new AiProviderError(
      'AI_MISSING_CREDENTIALS',
      'configuration',
      'AI credentials are not configured.',
    );
  }
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs ?? 25_000,
    maxTokens: config.maxTokens ?? defaults.maxTokens,
    maxInputChars: config.maxInputChars ?? defaults.maxInputChars,
    policyVersion: config.policyVersion ?? defaults.policyVersion,
    fetchImpl: config.fetchImpl,
  };
}

export function truncateField(value: string | null | undefined, maxChars: number): string | null {
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

export interface OpenAiCompatibleJsonCompletion {
  /** Parsed JSON object from message content (after fence strip / JSON parse). */
  parsed: unknown;
  /** Model id from response payload when present, otherwise configured model. */
  modelVersion: string;
}

/**
 * Shared OpenAI-compatible Chat Completions transport:
 * credentials → fetch → status/error mapping → choices/refusal/content → JSON parse.
 *
 * Job-specific system/user payloads and validators remain with each provider.
 */
export async function completeOpenAiCompatibleJsonObject(params: {
  config: ResolvedOpenAiCompatibleTransportConfig;
  systemContent: string;
  userContent: string;
}): Promise<OpenAiCompatibleJsonCompletion> {
  const { config, systemContent, userContent } = params;
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: systemContent,
          },
          {
            role: 'user',
            content: userContent,
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
        model: config.model,
        policyVersion: config.policyVersion,
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
          model: config.model,
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
          model: config.model,
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
          model: config.model,
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
          model: typeof payload.model === 'string' ? payload.model : config.model,
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
          model: typeof payload.model === 'string' ? payload.model : config.model,
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
          model: typeof payload.model === 'string' ? payload.model : config.model,
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
          model: typeof payload.model === 'string' ? payload.model : config.model,
          requestId: typeof payload.id === 'string' ? payload.id : null,
        }),
      );
    }

    const parsed = parseModelJsonText(content);
    return {
      parsed,
      modelVersion: typeof payload.model === 'string' ? payload.model : config.model,
    };
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
