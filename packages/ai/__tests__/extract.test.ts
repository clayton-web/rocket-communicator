import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/errors.js';
import { buildInvalidOutputFingerprint } from '../src/diagnostics.js';
import {
  looksLikeProsePolicyRefusal,
  parseAndValidateExtractionOutput,
  parseModelJsonText,
  stripMarkdownJsonFences,
} from '../src/validate.js';
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

const extractInput = {
  organizationId: 'o',
  eventId: 'e',
  subject: 's',
  snippet: 'n',
  fromAddress: 'a@b.c',
  toAddresses: [] as string[],
  internalDate: '2026-07-17T00:00:00.000Z',
  excerptContent: null as string | null,
  excerptId: null as string | null,
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

  it('accepts multiple summary points and Unicode', () => {
    const result = parseAndValidateExtractionOutput(
      {
        summaryPoints: [
          { ...validPoint, id: 'sp_1', order: 0, value: 'Call tenant — confirm access' },
          {
            id: 'sp_2',
            kind: 'next_action',
            label: 'Follow up',
            order: 1,
            value: 'Follow up if no response «quoted»',
          },
        ],
      },
      { policyVersion: 'p', modelVersion: 'm' },
    );
    expect(result.summaryPoints).toHaveLength(2);
  });

  it('coerces numeric id and details alias to value (transport)', () => {
    const result = parseAndValidateExtractionOutput(
      {
        summaryPoints: [
          {
            id: 1,
            kind: 'request',
            label: 'Call',
            order: 0,
            details: 'Please call the tenant tomorrow.',
          },
        ],
      },
      { policyVersion: 'p', modelVersion: 'm' },
    );
    expect(result.summaryPoints[0]).toMatchObject({
      id: '1',
      value: 'Please call the tenant tomorrow.',
    });
  });

  it('ignores extra properties on points', () => {
    const result = parseAndValidateExtractionOutput(
      {
        summaryPoints: [{ ...validPoint, dueDate: '2026-07-18', extra: true }],
      },
      { policyVersion: 'p', modelVersion: 'm' },
    );
    expect(result.summaryPoints[0]?.kind).toBe('request');
  });

  it('rejects empty summaryPoints as AI_EMPTY_OUTPUT', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [] },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_EMPTY_OUTPUT' }));
  });

  it('rejects schema-invalid kinds as AI_SCHEMA_INVALID', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [{ ...validPoint, kind: 'not_a_kind' }] },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('rejects missing value without inventing', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        {
          summaryPoints: [{ id: 'sp_1', kind: 'request', label: 'X', order: 0 }],
        },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('rejects wrong types', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        {
          summaryPoints: [{ ...validPoint, order: '0' }],
        },
        { policyVersion: 'p', modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('rejects malformed JSON text as AI_MALFORMED_JSON', () => {
    expect(() => parseModelJsonText('{not-json')).toThrow(
      expect.objectContaining({ code: 'AI_MALFORMED_JSON' }),
    );
  });

  it('strips markdown fences before parse', () => {
    const raw = parseModelJsonText(
      '```json\n' +
        JSON.stringify({
          summaryPoints: [validPoint],
          proposedDueAt: null,
          proposedPriority: null,
          proposedRecipientHint: null,
        }) +
        '\n```',
    );
    const result = parseAndValidateExtractionOutput(raw, {
      policyVersion: 'p',
      modelVersion: 'm',
    });
    expect(result.summaryPoints).toHaveLength(1);
  });

  it('stripMarkdownJsonFences leaves plain JSON unchanged', () => {
    expect(stripMarkdownJsonFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('looksLikeProsePolicyRefusal', () => {
  it('does not refuse valid JSON that mentions cannot assist in a field', () => {
    const content = JSON.stringify({
      summaryPoints: [
        {
          ...validPoint,
          value: 'Tenant said they cannot assist with Friday access',
        },
      ],
    });
    expect(looksLikeProsePolicyRefusal(content)).toBe(false);
  });

  it('detects leading prose refusal only', () => {
    expect(looksLikeProsePolicyRefusal("I can't assist with that request.")).toBe(true);
  });
});

describe('buildInvalidOutputFingerprint', () => {
  it('omits private content and bounds length', () => {
    const fp = buildInvalidOutputFingerprint({
      contentPresent: true,
      contentLength: 9999,
      topLevelKeys: ['summaryPoints', 'proposedDueAt'],
      schemaIssueCodes: ['point_value_missing'],
      model: 'gpt-4o-mini',
      policyVersion: 'a6-suggestion-v1',
    });
    expect(fp).toContain('content=yes');
    expect(fp).toContain('issues=point_value_missing');
    expect(fp).not.toMatch(/Please call|tenant|password|sk-/i);
    expect(fp.length).toBeLessThanOrEqual(400);
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
  it('classifies timeout, quota, rate limit, 5xx, auth, and policy refusal', async () => {
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
    await expect(timeoutProvider.extract(extractInput)).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
    });

    const quota = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota' } }),
          {
            status: 429,
          },
        ),
    });
    await expect(quota.extract(extractInput)).rejects.toMatchObject({
      code: 'AI_INSUFFICIENT_QUOTA',
    });

    const rate = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { type: 'rate_limit_exceeded', code: 'rate_limit_exceeded' } }),
          {
            status: 429,
          },
        ),
    });
    await expect(rate.extract(extractInput)).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' });

    const five = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () => new Response('{}', { status: 503 }),
    });
    await expect(five.extract(extractInput)).rejects.toMatchObject({ code: 'AI_PROVIDER_5XX' });

    const auth = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    await expect(auth.extract(extractInput)).rejects.toMatchObject({
      code: 'AI_INVALID_CREDENTIALS',
      kind: 'configuration',
    });

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
    await expect(refuse.extract(extractInput)).rejects.toMatchObject({
      code: 'AI_POLICY_REFUSAL',
      kind: 'permanent',
    });
  });

  it('does not false-refuse JSON containing refusal-like words', async () => {
    const provider = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    summaryPoints: [
                      {
                        ...validPoint,
                        value: 'Owner cannot assist Friday; call vendor instead',
                      },
                    ],
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
    const out = await provider.extract(extractInput);
    expect(out.summaryPoints[0]?.kind).toBe('request');
  });

  it('accepts fenced JSON and production-shaped numeric id + details', async () => {
    const provider = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content:
                    '```json\n' +
                    JSON.stringify({
                      summaryPoints: [
                        {
                          id: 1,
                          kind: 'request',
                          label: 'Call tenant',
                          order: 1,
                          dueDate: '2026-07-18',
                          details: 'Please call the tenant tomorrow and confirm access for Friday.',
                        },
                      ],
                      proposedDueAt: null,
                      proposedPriority: 'normal',
                      proposedRecipientHint: null,
                    }) +
                    '\n```',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const out = await provider.extract({
      ...extractInput,
      subject: 'Access',
      snippet: 'Please call the tenant tomorrow and confirm access for Friday.',
      excerptContent: 'Please call the tenant tomorrow and confirm access for Friday.',
      excerptId: 'ex_1',
    });
    expect(out.summaryPoints[0]).toMatchObject({
      id: '1',
      kind: 'request',
      value: 'Please call the tenant tomorrow and confirm access for Friday.',
    });
  });

  it('classifies empty and malformed content', async () => {
    const empty = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: null } }], model: 'm' }), {
          status: 200,
        }),
    });
    await expect(empty.extract(extractInput)).rejects.toMatchObject({ code: 'AI_EMPTY_OUTPUT' });

    const bad = new OpenAiCompatibleSuggestionProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'not-json' } }], model: 'm' }),
          { status: 200 },
        ),
    });
    await expect(bad.extract(extractInput)).rejects.toMatchObject({ code: 'AI_MALFORMED_JSON' });
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

  it('does not leak secrets in thrown errors', async () => {
    const secret = 'sk-secret-should-never-appear';
    const provider = new OpenAiCompatibleSuggestionProvider({
      apiKey: secret,
      model: 'm',
      fetchImpl: async () => new Response('{}', { status: 503 }),
    });
    try {
      await provider.extract(extractInput);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect(String(error)).not.toContain(secret);
      expect((error as AiProviderError).message).not.toContain(secret);
      expect((error as AiProviderError).diagnosticFingerprint ?? '').not.toContain(secret);
    }
  });
});
