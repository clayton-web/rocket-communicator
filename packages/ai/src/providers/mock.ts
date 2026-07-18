import type {
  SuggestionExtractionInput,
  SuggestionExtractionProvider,
  SuggestionExtractionResult,
} from '../types.js';
import { AiProviderError } from '../errors.js';

export interface MockSuggestionProviderOptions {
  result?: SuggestionExtractionResult;
  error?: AiProviderError;
  handler?: (
    input: SuggestionExtractionInput,
  ) => Promise<SuggestionExtractionResult> | SuggestionExtractionResult;
}

/** Deterministic test seam — no network. */
export class MockSuggestionExtractionProvider implements SuggestionExtractionProvider {
  readonly name = 'mock';
  private readonly options: MockSuggestionProviderOptions;

  constructor(options: MockSuggestionProviderOptions = {}) {
    this.options = options;
  }

  async extract(input: SuggestionExtractionInput): Promise<SuggestionExtractionResult> {
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
      'Mock provider has no configured result.',
    );
  }
}
