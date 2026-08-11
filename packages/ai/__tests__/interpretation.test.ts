import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/errors.js';
import { INTERPRETATION_SCHEMA_INSTRUCTION } from '../src/interpretation-policy.js';
import { parseAndValidateInterpretationOutput } from '../src/interpretation-validate.js';
import { MockInterpretationProvider } from '../src/providers/mock-interpretation.js';
import { OpenAiCompatibleInterpretationProvider } from '../src/providers/openai-compatible-interpretation.js';
import {
  DEFAULT_INTERPRETATION_POLICY_VERSION,
  DEFAULT_SUGGESTION_POLICY_VERSION,
} from '../src/types.js';
import { parseAndValidateExtractionOutput } from '../src/validate.js';
import { interpretationFixtures } from './fixtures/interpretation-fixtures.js';

const defaults = {
  policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
  modelVersion: 'fixture-model',
};

describe('parseAndValidateInterpretationOutput', () => {
  it('A: accepts a single actionable proposed task', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.A_singleTask.modelOutput,
      defaults,
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.summaryPoints[0]).toMatchObject({
      kind: 'next_action',
      value: 'Call Sharon about the listing agreement',
    });
    expect(result.tasks[0]?.peopleHints).toEqual(['Sharon']);
    expect(result.tasks[0]?.deadlineExpression).toBeNull();
    expect(result.policyVersion).toBe(DEFAULT_INTERPRETATION_POLICY_VERSION);
  });

  it('B: accepts multiple distinct proposed tasks', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.B_multipleTasks.modelOutput,
      defaults,
    );
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]?.peopleHints).toEqual(['Sharon']);
    expect(result.tasks[0]?.deadlineExpression).toBe('tomorrow');
    expect(result.tasks[1]?.peopleHints).toEqual(['Kevin']);
    expect(result.tasks[1]?.deadlineExpression).toBeNull();
  });

  it('C: treats tasks: [] as successful empty interpretation (not AI_EMPTY_OUTPUT)', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.C_noTask.modelOutput,
      defaults,
    );
    expect(result.tasks).toEqual([]);
    expect(result.policyVersion).toBe(DEFAULT_INTERPRETATION_POLICY_VERSION);
  });

  it('D: accepts one task from mixed actionable / non-actionable input shape', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.D_mixed.modelOutput,
      defaults,
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.peopleHints).toEqual(['Kevin']);
  });

  it('E: preserves grounded deadline expression', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.E_deadlineExpression.modelOutput,
      defaults,
    );
    expect(result.tasks[0]?.deadlineExpression).toBe('tomorrow afternoon');
  });

  it('F: accepts null deadline when none grounded', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.F_noInventedDeadline.modelOutput,
      defaults,
    );
    expect(result.tasks[0]?.deadlineExpression).toBeNull();
  });

  it('G: accepts one coherent multi-point task', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.G_multiPointSingleTask.modelOutput,
      defaults,
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.summaryPoints).toHaveLength(2);
    expect(result.tasks[0]?.deadlineExpression).toBe('tomorrow');
  });

  it('H: accepts peopleHints as names without inventing recipients/emails', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.H_peopleHint.modelOutput,
      defaults,
    );
    expect(result.tasks[0]?.peopleHints).toEqual(['Sharon']);
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });

  it('H: rejects email-shaped peopleHints', () => {
    expect(() =>
      parseAndValidateInterpretationOutput(
        interpretationFixtures.H_invalidEmailHint.modelOutput,
        defaults,
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('I: rejects claimed task with empty summaryPoints (not empty success)', () => {
    expect(() =>
      parseAndValidateInterpretationOutput(
        interpretationFixtures.I_invalidClaimedTaskEmpty.modelOutput,
        defaults,
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('I: rejects claimed task with no actionable summary point', () => {
    expect(() =>
      parseAndValidateInterpretationOutput(
        interpretationFixtures.I_invalidClaimedTaskNonActionable.modelOutput,
        defaults,
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('slice goal: Sharon + Kevin proposals; Carlie omitted', () => {
    const result = parseAndValidateInterpretationOutput(
      interpretationFixtures.sliceGoal_mixedThreeStatements.modelOutput,
      defaults,
    );
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((t) => t.peopleHints[0])).toEqual(['Sharon', 'Kevin']);
    expect(JSON.stringify(result)).not.toMatch(/Carlie/i);
  });

  it('rejects missing tasks array', () => {
    expect(() =>
      parseAndValidateInterpretationOutput({}, defaults),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('rejects more than MAX_PROPOSED_TASKS', () => {
    const tasks = Array.from({ length: 11 }, (_, i) => ({
      summaryPoints: [
        {
          id: `sp_${i}`,
          kind: 'next_action',
          label: 'Act',
          order: 0,
          value: `Do thing ${i}`,
        },
      ],
      peopleHints: [],
      deadlineExpression: null,
    }));
    expect(() =>
      parseAndValidateInterpretationOutput({ tasks }, defaults),
    ).toThrow(expect.objectContaining({ code: 'AI_SCHEMA_INVALID' }));
  });

  it('rejects task with too many summary points (shared parser)', () => {
    const summaryPoints = Array.from({ length: 21 }, (_, i) => ({
      id: `sp_${i}`,
      kind: 'next_action',
      label: 'Act',
      order: i,
      value: `Do thing ${i}`,
    }));
    try {
      parseAndValidateInterpretationOutput(
        {
          tasks: [{ summaryPoints, peopleHints: [], deadlineExpression: null }],
        },
        defaults,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).code).toBe('AI_SCHEMA_INVALID');
      expect((error as AiProviderError).diagnosticFingerprint).toContain(
        'issues=summary_points_too_many',
      );
    }
  });

  it('rejects task with domain-invalid summary points (shared parser)', () => {
    try {
      parseAndValidateInterpretationOutput(
        {
          tasks: [
            {
              summaryPoints: [
                {
                  id: 'sp_1',
                  kind: 'next_action',
                  label: 'Act',
                  order: 0,
                  value: 'First',
                },
                {
                  id: 'sp_2',
                  kind: 'request',
                  label: 'Also',
                  order: 0,
                  value: 'Duplicate order',
                },
              ],
              peopleHints: [],
              deadlineExpression: null,
            },
          ],
        },
        defaults,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).code).toBe('AI_SCHEMA_INVALID');
      expect((error as AiProviderError).diagnosticFingerprint).toContain(
        'issues=domain_validate_failed',
      );
    }
  });

  it('defaults missing peopleHints to [] and blank deadlineExpression to null', () => {
    const result = parseAndValidateInterpretationOutput(
      {
        tasks: [
          {
            summaryPoints: [
              {
                id: 'sp_1',
                kind: 'request',
                label: 'Act',
                order: 0,
                value: 'Follow up with the vendor',
              },
            ],
          },
        ],
      },
      defaults,
    );
    expect(result.tasks[0]?.peopleHints).toEqual([]);
    expect(result.tasks[0]?.deadlineExpression).toBeNull();
  });
});

describe('interpretation vs A6 empty semantics (J)', () => {
  it('A6 extraction still treats empty summaryPoints as AI_EMPTY_OUTPUT', () => {
    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [] },
        { policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION, modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_EMPTY_OUTPUT' }));
  });

  it('interpretation treats empty tasks as success while A6 empty points remain failure', () => {
    const interpretation = parseAndValidateInterpretationOutput({ tasks: [] }, defaults);
    expect(interpretation.tasks).toEqual([]);

    expect(() =>
      parseAndValidateExtractionOutput(
        { summaryPoints: [] },
        { policyVersion: DEFAULT_SUGGESTION_POLICY_VERSION, modelVersion: 'm' },
      ),
    ).toThrow(expect.objectContaining({ code: 'AI_EMPTY_OUTPUT' }));
  });
});

describe('INTERPRETATION_SCHEMA_INSTRUCTION', () => {
  it('prohibits invention, reminders, and documents zero-task success', () => {
    expect(INTERPRETATION_SCHEMA_INSTRUCTION).toMatch(/tasks may be empty/i);
    expect(INTERPRETATION_SCHEMA_INSTRUCTION).toMatch(/Do NOT invent/i);
    expect(INTERPRETATION_SCHEMA_INSTRUCTION).toMatch(/Do NOT propose reminders/i);
    expect(INTERPRETATION_SCHEMA_INSTRUCTION).toMatch(/peopleHints/i);
    expect(INTERPRETATION_SCHEMA_INSTRUCTION).toMatch(/deadlineExpression/i);
  });
});

describe('MockInterpretationProvider', () => {
  it('returns configured result including empty tasks', async () => {
    const provider = new MockInterpretationProvider({
      result: {
        tasks: [],
        policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
        modelVersion: 'mock',
      },
    });
    const out = await provider.interpret({ rawInput: 'Thanks for lunch.' });
    expect(out.tasks).toEqual([]);
  });

  it('throws configured error', async () => {
    const provider = new MockInterpretationProvider({
      error: new AiProviderError('AI_TIMEOUT', 'retryable', 'timeout'),
    });
    await expect(provider.interpret({ rawInput: 'x' })).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
    });
  });
});

describe('OpenAiCompatibleInterpretationProvider', () => {
  it('validates successful interpretation JSON including tasks: []', async () => {
    const provider = new OpenAiCompatibleInterpretationProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                message: {
                  content: JSON.stringify(interpretationFixtures.C_noTask.modelOutput),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const out = await provider.interpret({
      rawInput: interpretationFixtures.C_noTask.input,
      timezone: 'America/Los_Angeles',
    });
    expect(out.tasks).toEqual([]);
    expect(out.modelVersion).toBe('gpt-test');
    expect(out.policyVersion).toBe(DEFAULT_INTERPRETATION_POLICY_VERSION);
  });

  it('validates multi-task fixture via provider path', async () => {
    const provider = new OpenAiCompatibleInterpretationProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        expect(body.messages[0]?.content).toContain('deadlineExpression');
        expect(body.messages[1]?.content).toContain('Call Sharon tomorrow');
        return new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                message: {
                  content: JSON.stringify(interpretationFixtures.B_multipleTasks.modelOutput),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const out = await provider.interpret({
      rawInput: interpretationFixtures.B_multipleTasks.input,
      capturedAt: '2026-08-07T20:00:00.000Z',
      timezone: 'America/Los_Angeles',
    });
    expect(out.tasks).toHaveLength(2);
  });

  it('rejects invalid claimed empty task from provider content', async () => {
    const provider = new OpenAiCompatibleInterpretationProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'm',
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    interpretationFixtures.I_invalidClaimedTaskEmpty.modelOutput,
                  ),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    await expect(provider.interpret({ rawInput: 'x' })).rejects.toMatchObject({
      code: 'AI_SCHEMA_INVALID',
    });
  });

  it('classifies insufficient quota via shared transport', async () => {
    const provider = new OpenAiCompatibleInterpretationProvider({
      apiKey: 'sk',
      model: 'm',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { type: 'insufficient_quota', code: 'insufficient_quota' } }),
          { status: 429 },
        ),
    });
    await expect(provider.interpret({ rawInput: 'x' })).rejects.toMatchObject({
      code: 'AI_INSUFFICIENT_QUOTA',
      kind: 'retryable',
    });
  });

  it('sends only context-free fields (no history keys)', async () => {
    const provider = new OpenAiCompatibleInterpretationProvider({
      apiKey: 'sk',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const userPayload = JSON.parse(body.messages[1]!.content) as Record<string, unknown>;
        expect(Object.keys(userPayload).sort()).toEqual([
          'capturedAt',
          'rawInput',
          'timezone',
        ]);
        expect(userPayload).not.toHaveProperty('previousTasks');
        expect(userPayload).not.toHaveProperty('recipients');
        return new Response(
          JSON.stringify({
            model: 'gpt-test',
            choices: [
              {
                message: {
                  content: JSON.stringify(interpretationFixtures.C_noTask.modelOutput),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await provider.interpret({
      rawInput: 'Thanks',
      capturedAt: null,
      timezone: null,
    });
  });
});
