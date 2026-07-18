/**
 * Privacy-safe diagnostic fingerprints for AI failures.
 * Never include prompts, email content, model bodies, or credentials.
 */

export interface InvalidOutputFingerprintInput {
  model?: string;
  policyVersion?: string;
  finishReason?: string | null;
  contentPresent: boolean;
  contentLength: number;
  topLevelKeys?: string[];
  schemaIssueCodes?: string[];
  providerStatus?: number;
  providerErrorType?: string | null;
  providerErrorCode?: string | null;
  requestId?: string | null;
}

/** Compact, log-/audit-safe fingerprint (no private content). */
export function buildInvalidOutputFingerprint(input: InvalidOutputFingerprintInput): string {
  const parts: string[] = [];
  if (input.providerStatus != null) {
    parts.push(`status=${input.providerStatus}`);
  }
  if (input.providerErrorType) {
    parts.push(`errType=${sanitizeToken(input.providerErrorType)}`);
  }
  if (input.providerErrorCode) {
    parts.push(`errCode=${sanitizeToken(input.providerErrorCode)}`);
  }
  if (input.finishReason) {
    parts.push(`finish=${sanitizeToken(input.finishReason)}`);
  }
  parts.push(`content=${input.contentPresent ? 'yes' : 'no'}`);
  parts.push(`len=${Math.max(0, Math.trunc(input.contentLength))}`);
  if (input.topLevelKeys && input.topLevelKeys.length > 0) {
    parts.push(`keys=${input.topLevelKeys.slice(0, 12).map(sanitizeToken).join(',')}`);
  }
  if (input.schemaIssueCodes && input.schemaIssueCodes.length > 0) {
    parts.push(`issues=${input.schemaIssueCodes.slice(0, 8).map(sanitizeToken).join(',')}`);
  }
  if (input.model) {
    parts.push(`model=${sanitizeToken(input.model)}`);
  }
  if (input.policyVersion) {
    parts.push(`policy=${sanitizeToken(input.policyVersion)}`);
  }
  if (input.requestId) {
    parts.push(`req=${sanitizeToken(input.requestId)}`);
  }
  return parts.join('|').slice(0, 400);
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 64);
}
