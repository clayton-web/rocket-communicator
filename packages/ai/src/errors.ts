import type { AiProviderErrorCode, AiProviderErrorKind } from './types.js';

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly kind: AiProviderErrorKind;

  constructor(code: AiProviderErrorCode, kind: AiProviderErrorKind, message: string) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.kind = kind;
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}
