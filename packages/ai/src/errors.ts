import type { AiProviderErrorCode, AiProviderErrorKind } from './types.js';

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly kind: AiProviderErrorKind;
  /** Privacy-safe operational fingerprint; never contains private content. */
  readonly diagnosticFingerprint?: string;

  constructor(
    code: AiProviderErrorCode,
    kind: AiProviderErrorKind,
    message: string,
    diagnosticFingerprint?: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.kind = kind;
    this.diagnosticFingerprint = diagnosticFingerprint;
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}
