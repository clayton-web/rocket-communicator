import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/errors.js';
import { parseAndValidateExtractionOutput, parseModelJsonText } from '../src/validate.js';
import { MockSuggestionExtractionProvider } from '../src/providers/mock.js';
import {
  assertSuggestionAiConfigured,
  createSuggestionExtractionProvider,
  readSuggestionAiEnvConfig,
} from '../src/config.js';
import { OpenAiCompatibleSuggestionProvider } from '../src/providers/openai-compatible.js';
import { DEFAULT_SUGGESTION_POLICY_VERSION } from '../src/types.js';

const validPoint = {
  id: 'sp_1',
  kind: 'request',
  label: 'Action',
  order: 0,
  value: 'Please review the invoice',
};

describe('parseAndValidateExtractionOutput', () => {
  it('accepts valid structured output', () => {
    const result = parseAndValidateExtractionOutput(
      {
        summaryPoints: [validPoint],
        proposedDueAt: null,
        proposedPriority: 'normal',
        proposedRecipientHint: null,
      },
      { policyVersion: 'policy-test', modelVersion: 'model-test' },
    );
    expect(result.summaryPoints).toHaveLength(1);
    expect(result.policyVersion).toBe('policy-test');
    expect(result.modelVersion).toBe('model-test');
    expect(result.proposedPriority).toBe('normal');
  });

  it('rejects empty summaryPoints', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [] },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(AiProviderError);
  });

  it('rejects schema-invalid kinds', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [{ ...validPoint, kind: 'not_a_kind' }] },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(AiProviderError);
  });

  it('rejects malformed JSON text', () => {
    expect(() => parseModelJsonText('{not-json')).toThrow(AiProviderError);
  });
});

describe('MockSuggestionExtractionProvider', () => {
  it('returns configured result', async () => {
    const provider = new MockSuggestionExtractionProvider({
      result: {
        summaryPoints: [validPoint as never],
        policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION,
        modelVersion: 'mock',
      },
    });
    const out = await provider.extract({
      organizationId: 'org',
      eventId: 'evt',
      subject: 'Hi',
      snippet: 'Body',
      fromAddress: 'a@b.c',
      toAddresses: ['d@e.f'],
      internalDate: '2026-07-17T00:00:00.000Z',
      excerptContent: null,
      excerptId: null,
    });
    expect(out.modelVersion).toBe('mock');
  });

  it('throws configured provider error', async () => {
    const provider = new MockSuggestionExtractionProvider({
      error: new AiProviderError('AI_TIMEOUT', 'retryable', 'timeout'),
    });
    await expect(
      provider.extract({
        organizationId: 'org',
        eventId: 'evt',
        subject: null,
        snippet: null,
        fromAddress: 'a@b.c',
        toAddresses: [],
        internalDate: '2026-07-17T00:00:00.000Z',
        excerptContent: null,
        excerptId: null,
      }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT', kind: 'retryable' });
  });
});

describe('AI configuration', () => {
  it('detects missing credentials as configuration failure', () => {
    const config = readSuggestionAiEnvConfig({
      SUGGESTION_AI_ENABLED: 'true',
      OPENAI_API_KEY: '',
    });
    expect(() => assertSuggestionAiConfigured(config)).toThrow(
      expect.objectContaining({ code: 'AI_MISSING_CREDENTIALS', kind: 'configuration' }),
    );
  });

  it('detects explicitly disabled AI', () => {
    const config = readSuggestionAiEnvConfig({
      SUGGESTION_AI_ENABLED: 'false',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(() => assertSuggestionAiConfigured(config)).toThrow(
      expect.objectContaining({ code: 'AI_DISABLED', kind: 'configuration' }),
    );
  });

  it('creates openai-compatible provider when configured', () => {
    const provider = createSuggestionExtractionProvider({
      enabled: true,
      apiKey: 'sk-test',
      baseUrl: null,
      model: 'gpt-4o-mini',
      policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION,
    });
    expect(provider.name).toBe('openai-compatible');
  });
});

describe('OpenAiCompatibleSuggestionProvider', () => {
  it('classifies timeout, rate limit, 5xx, and policy refusal', async () => {
    const timeoutProvider = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      timeoutMs: 5,
      fetchImpl: async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
        return new Response('{}', { status: 200 });
      },
    });
    await expect(
      timeoutProvider.extract({
        organizationId: 'o',
        eventId: 'e',
        subject: 's',
        snippet: 'n',
        fromAddress: 'a@b.c',
        toAddresses: [],
        internalDate: '2026-07-17T00:00:00.000Z',
        excerptContent: null,
        excerptId: null,
      }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });

    const rate = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () => new Response('{}', { status: 429 }),
    });
    await expect(
      rate.extract({
        organizationId: 'o',
        eventId: 'e',
        subject: 's',
        snippet: 'n',
        fromAddress: 'a@b.c',
        toAddresses: [],
        internalDate: '2026-07-17T00:00:00.000Z',
        excerptContent: null,
        excerptId: null,
      }),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' });

    const five = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () => new Response('{}', { status: 503 }),
    });
    await expect(
      five.extract({
        organizationId: 'o',
        eventId: 'e',
        subject: 's',
        snippet: 'n',
        fromAddress: 'a@b.c',
        toAddresses: [],
        internalDate: '2026-07-17T00:00:00.000Z',
        excerptContent: null,
        excerptId: null,
      }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_5XX' });

    const refuse = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { refusal: 'policy' } }],
            model: 'm',
          }),
          { status: 200 },
        ),
    });
    await expect(
      refuse.extract({
        organizationId: 'o',
        eventId: 'e',
        subject: 's',
        snippet: 'n',
        fromAddress: 'a@b.c',
        toAddresses: [],
        internalDate: '2026-07-17T00:00:00.000Z',
        excerptContent: null,
        excerptId: null,
      }),
    ).rejects.toMatchObject({ code: 'AI_POLICY_REFUSAL', kind: 'permanent' });
  });

  it('validates successful JSON content', async () => {
    const provider = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summaryPoints: [validPoint],
                    proposedDueAt: null,
                    proposedPriority: null,
                    proposedRecipientHint: null,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const out = await provider.extract({
      organizationId: 'o',
      eventId: 'e',
      subject: 'Invoice',
      snippet: 'Please pay',
      fromAddress: 'a@b.c',
      toAddresses: ['x@y.z'],
      internalDate: '2026-07-17T00:00:00.000Z',
      excerptContent: 'Please pay by Friday',
      excerptId: 'ex_1',
    });
    expect(out.summaryPoints[0]?.kind).toBe('request');
    expect(out.modelVersion).toBe('gpt-test');
  });
});
