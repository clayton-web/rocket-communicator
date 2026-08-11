import { INTERPRETATION_SCHEMA_INSTRUCTION } from '../interpretation-policy.js';
import { parseAndValidateInterpretationOutput } from '../interpretation-validate.js';
import type {
  InterpretationInput,
  InterpretationProvider,
  InterpretationResult,
} from '../types.js';
import { DEFAULT_INTERPRETATION_POLICY_VERSION } from '../types.js';
import {
  completeOpenAiCompatibleJsonObject,
  resolveOpenAiCompatibleTransportConfig,
  truncateField,
  type OpenAiCompatibleTransportConfig,
  type ResolvedOpenAiCompatibleTransportConfig,
} from './openai-compatible-transport.js';

export type OpenAiCompatibleInterpretationConfig = OpenAiCompatibleTransportConfig;

const DEFAULT_MAX_TOKENS = 1600;
const DEFAULT_MAX_INPUT_CHARS = 4000;

/**
 * OpenAI-compatible Chat Completions adapter for context-free interpretation.
 * Uses json_object mode (same as A6). Does not create Tasks or call tools.
 */
export class OpenAiCompatibleInterpretationProvider implements InterpretationProvider {
  readonly name = 'openai-compatible-interpretation';
  private readonly config: ResolvedOpenAiCompatibleTransportConfig;

  constructor(config: OpenAiCompatibleInterpretationConfig) {
    this.config = resolveOpenAiCompatibleTransportConfig(config, {
      maxTokens: DEFAULT_MAX_TOKENS,
      maxInputChars: DEFAULT_MAX_INPUT_CHARS,
      policyVersion: DEFAULT_INTERPRETATION_POLICY_VERSION,
    });
  }

  async interpret(input: InterpretationInput): Promise<InterpretationResult> {
    const maxChars = this.config.maxInputChars;
    const { parsed, modelVersion } = await completeOpenAiCompatibleJsonObject({
      config: this.config,
      systemContent:
        'You interpret context-free text into zero or more distinct proposed tasks. ' +
        'This is a constrained structured-output operation: no tools, no loops, no reminders, no assignment. ' +
        INTERPRETATION_SCHEMA_INSTRUCTION,
      userContent: JSON.stringify({
        rawInput: truncateField(input.rawInput, maxChars),
        capturedAt: input.capturedAt ?? null,
        timezone: input.timezone ?? null,
      }),
    });

    return parseAndValidateInterpretationOutput(parsed, {
      policyVersion: this.config.policyVersion,
      modelVersion,
    });
  }
}
