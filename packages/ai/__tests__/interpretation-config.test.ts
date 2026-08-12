/**
 * Shared interpretation provider composition (D169 S3.1).
 *
 * The factory exists so an authorized caller can build the shared interpretation provider from
 * environment configuration. It is default closed: credentials alone must not enable interpretation,
 * because no Production activation is authorized.
 */
import { describe, expect, it } from 'vitest';
import {
  assertInterpretationAiConfigured,
  createInterpretationProvider,
  readInterpretationAiEnvConfig,
  DEFAULT_INTERPRETATION_POLICY_VERSION,
} from '../src/index.js';

describe('interpretation provider composition', () => {
  it('is disabled by default, even with credentials present', () => {
    const config = readInterpretationAiEnvConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(config.enabled).toBe(false);
    expect(() => assertInterpretationAiConfigured(config)).toThrow(
      expect.objectContaining({ code: 'AI_DISABLED', kind: 'configuration' }),
    );
    expect(() => createInterpretationProvider(config)).toThrow(
      expect.objectContaining({ code: 'AI_DISABLED' }),
    );
  });

  it('stays disabled for anything other than an explicit true', () => {
    for (const flag of ['', 'false', '1', 'yes', 'TRUE ']) {
      const config = readInterpretationAiEnvConfig({
        INTERPRETATION_AI_ENABLED: flag,
        OPENAI_API_KEY: 'sk-test',
      });
      expect(config.enabled).toBe(flag.trim().toLowerCase() === 'true');
    }
  });

  it('requires credentials once explicitly enabled', () => {
    const config = readInterpretationAiEnvConfig({ INTERPRETATION_AI_ENABLED: 'true' });
    expect(config.enabled).toBe(true);
    expect(() => createInterpretationProvider(config)).toThrow(
      expect.objectContaining({ code: 'AI_MISSING_CREDENTIALS', kind: 'configuration' }),
    );
  });

  it('reads model, base URL, and policy version with interpretation defaults', () => {
    const defaults = readInterpretationAiEnvConfig({});
    expect(defaults.model).toBe('gpt-4o-mini');
    expect(defaults.baseUrl).toBeNull();
    expect(defaults.policyVersion).toBe(DEFAULT_INTERPRETATION_POLICY_VERSION);

    const explicit = readInterpretationAiEnvConfig({
      INTERPRETATION_AI_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://proxy.example/v1',
      OPENAI_MODEL: 'gpt-test',
      INTERPRETATION_AI_POLICY_VERSION: 'interpretation-v9',
    });
    expect(explicit).toMatchObject({
      enabled: true,
      baseUrl: 'https://proxy.example/v1',
      model: 'gpt-test',
      policyVersion: 'interpretation-v9',
    });
  });

  it('builds the shared interpretation provider when fully configured', async () => {
    const provider = createInterpretationProvider(
      readInterpretationAiEnvConfig({
        INTERPRETATION_AI_ENABLED: 'true',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MODEL: 'gpt-test',
      }),
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              model: 'gpt-test',
              choices: [{ message: { content: JSON.stringify({ tasks: [] }) } }],
            }),
            { status: 200 },
          ),
      },
    );

    expect(provider.name).toBe('openai-compatible-interpretation');
    const result = await provider.interpret({ rawInput: 'Thanks!' });
    expect(result.tasks).toEqual([]);
    expect(result.policyVersion).toBe(DEFAULT_INTERPRETATION_POLICY_VERSION);
  });
});
