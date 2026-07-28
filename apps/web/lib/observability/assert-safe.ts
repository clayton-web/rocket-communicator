import { redactCapabilitySecrets } from '@/lib/capability/redact';

/**
 * Assert a diagnostic payload cannot contain a raw capability token or raw `/c/{token}` path (D114).
 * Throws when the assertion fails — intended for tests and issuance-time guards.
 */
export function assertNoCapabilitySecretInDiagnostic(value: unknown, context: string): void {
  const serialized =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value);

  if (/\/c\/[A-Za-z0-9_-]{20,}/.test(serialized)) {
    throw new Error(`Raw capability path must not appear in ${context}.`);
  }

  // After redaction the string must not still look like an opaque capability token path.
  const redacted = redactCapabilitySecrets(serialized);
  if (/\/c\/[A-Za-z0-9_-]{20,}/.test(redacted)) {
    throw new Error(`Capability path survived redaction in ${context}.`);
  }
}

/**
 * Returns true when a candidate string looks like a capability path secret segment.
 * Used by structural tests; not a substitute for redactCapabilitySecrets.
 */
export function looksLikeRawCapabilityPath(value: string): boolean {
  return /\/c\/[A-Za-z0-9_-]{20,}/.test(value);
}
