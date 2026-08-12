import { AiProviderError } from './errors.js';
import type { InterpretationProvider } from './types.js';
import { DEFAULT_INTERPRETATION_POLICY_VERSION } from './types.js';
import { OpenAiCompatibleInterpretationProvider } from './providers/openai-compatible-interpretation.js';

export interface InterpretationAiEnvConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  policyVersion: string;
}

/**
 * Read shared-interpretation configuration from environment (names only; never logs values).
 *
 * - INTERPRETATION_AI_ENABLED: must be exactly "true" to enable
 * - OPENAI_API_KEY: required when enabled
 * - OPENAI_BASE_URL: optional OpenAI-compatible base URL
 * - OPENAI_MODEL: optional model id (default gpt-4o-mini)
 * - INTERPRETATION_AI_POLICY_VERSION: optional policy version string
 *
 * Unlike {@link readSuggestionAiEnvConfig}, this reader is **default closed**: absent or malformed
 * configuration leaves interpretation disabled rather than enabled-when-credentials-exist. The A6
 * reader may default open because A6 is an established Production path; the shared interpretation
 * path (D169 S3.1) has no authorized Production activation, so present credentials must not be
 * enough to turn it on.
 */
export function readInterpretationAiEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): InterpretationAiEnvConfig {
  const enabledFlag = env.INTERPRETATION_AI_ENABLED;
  const enabled = typeof enabledFlag === 'string' && enabledFlag.trim().toLowerCase() === 'true';
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
    typeof env.INTERPRETATION_AI_POLICY_VERSION === 'string' &&
    env.INTERPRETATION_AI_POLICY_VERSION.length > 0
      ? env.INTERPRETATION_AI_POLICY_VERSION
      : DEFAULT_INTERPRETATION_POLICY_VERSION;

  return { enabled, apiKey, baseUrl, model, policyVersion };
}

/**
 * Assert shared-interpretation configuration is usable before calling a provider.
 * Throws AiProviderError with kind=configuration on setup problems.
 */
export function assertInterpretationAiConfigured(
  config: InterpretationAiEnvConfig = readInterpretationAiEnvConfig(),
): void {
  if (!config.enabled) {
    throw new AiProviderError('AI_DISABLED', 'configuration', 'Shared interpretation is disabled.');
  }
  if (!config.apiKey) {
    throw new AiProviderError(
      'AI_MISSING_CREDENTIALS',
      'configuration',
      'AI credentials are not configured.',
    );
  }
}

/**
 * Compose the shared interpretation provider from environment configuration.
 *
 * Existence of this factory does not make interpretation reachable from any product surface: it
 * refuses to build a provider unless interpretation is explicitly enabled, and no route, worker, or
 * cron calls it.
 */
export function createInterpretationProvider(
  config: InterpretationAiEnvConfig = readInterpretationAiEnvConfig(),
  options?: { fetchImpl?: typeof fetch },
): InterpretationProvider {
  assertInterpretationAiConfigured(config);
  return new OpenAiCompatibleInterpretationProvider({
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl ?? undefined,
    model: config.model,
    policyVersion: config.policyVersion,
    fetchImpl: options?.fetchImpl,
  });
}
