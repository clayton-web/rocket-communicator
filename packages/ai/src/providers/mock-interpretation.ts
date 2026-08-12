import { AiProviderError } from '../errors.js';
import type {
  InterpretationInput,
  InterpretationProvider,
  InterpretationResult,
} from '../types.js';

export interface MockInterpretationProviderOptions {
  result?: InterpretationResult;
  error?: AiProviderError;
  handler?: (input: InterpretationInput) => Promise<InterpretationResult> | InterpretationResult;
}

/** Deterministic test seam for interpretation — no network. */
export class MockInterpretationProvider implements InterpretationProvider {
  readonly name = 'mock-interpretation';
  private readonly options: MockInterpretationProviderOptions;

  constructor(options: MockInterpretationProviderOptions = {}) {
    this.options = options;
  }

  async interpret(input: InterpretationInput): Promise<InterpretationResult> {
    if (this.options.error) {
      throw this.options.error;
    }
    if (this.options.handler) {
      return this.options.handler(input);
    }
    if (this.options.result) {
      return this.options.result;
    }
    throw new AiProviderError(
      'AI_EMPTY_OUTPUT',
      'retryable',
      'Mock interpretation provider has no configured result.',
    );
  }
}
