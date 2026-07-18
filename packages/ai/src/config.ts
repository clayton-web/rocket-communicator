import { AiProviderError } from './errors.js';
import type { SuggestionExtractionProvider } from './types.js';
import { OpenAiCompatibleSuggestionProvider } from './providers/openai-compatible.js';
import { DEFAULT_SUGGESTION_POLICY_VERSION } from './types.js';

export interface SuggestionAiEnvConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  policyVersion: string;
}

/**
 * Read AI configuration from environment (names only; never logs values).
 *
 * - SUGGESTION_AI_ENABLED: "false" disables; otherwise enabled when credentials exist
 * - OPENAI_API_KEY: required when enabled
 * - OPENAI_BASE_URL: optional OpenAI-compatible base URL
 * - OPENAI_MODEL: optional model id (default gpt-4o-mini)
 * - SUGGESTION_AI_POLICY_VERSION: optional policy version string
 */
export function readSuggestionAiEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): SuggestionAiEnvConfig {
  const enabledFlag = env.SUGGESTION_AI_ENABLED;
  const explicitlyDisabled =
    typeof enabledFlag === 'string' && enabledFlag.trim().toLowerCase() === 'false';
  const apiKey =
    typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.length > 0
      ? env.OPENAI_API_KEY
      : null;
  const baseUrl =
    typeof env.OPENAI_BASE_URL === 'string' && env.OPENAI_BASE_URL.length > 0
      ? env.OPENAI_BASE_URL
      : null;
  const model =
    typeof env.OPENAI_MODEL === 'string' && env.OPENAI_MODEL.length > 0
      ? env.OPENAI_MODEL
      : 'gpt-4o-mini';
  const policyVersion =
    typeof env.SUGGESTION_AI_POLICY_VERSION === 'string' &&
    env.SUGGESTION_AI_POLICY_VERSION.length > 0
      ? env.SUGGESTION_AI_POLICY_VERSION
      : DEFAULT_SUGGESTION_POLICY_VERSION;

  return {
    enabled: !explicitlyDisabled,
    apiKey,
    baseUrl,
    model,
    policyVersion,
  };
}

/**
 * Assert global AI configuration is usable before claiming events.
 * Throws AiProviderError with kind=configuration on setup problems.
 */
export function assertSuggestionAiConfigured(
  config: SuggestionAiEnvConfig = readSuggestionAiEnvConfig(),
): void {
  if (!config.enabled) {
    throw new AiProviderError(
      'AI_DISABLED',
      'configuration',
      'Suggestion AI extraction is disabled.',
    );
  }
  if (!config.apiKey) {
    throw new AiProviderError(
      'AI_MISSING_CREDENTIALS',
      'configuration',
      'AI credentials are not configured.',
    );
  }
}

export function createSuggestionExtractionProvider(
  config: SuggestionAiEnvConfig = readSuggestionAiEnvConfig(),
  options?: { fetchImpl?: typeof fetch },
): SuggestionExtractionProvider {
  assertSuggestionAiConfigured(config);
  return new OpenAiCompatibleSuggestionProvider({
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl ?? undefined,
    model: config.model,
    policyVersion: config.policyVersion,
    fetchImpl: options?.fetchImpl,
  });
}
