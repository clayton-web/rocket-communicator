/**
 * Redact capability secrets from strings destined for logs, errors, or analytics.
 * Replaces `/c/{token}` path segments and long opaque base64url tokens.
 */
export function redactCapabilitySecrets(value: string): string {
  let result = value.replace(/\/c\/[A-Za-z0-9_-]{20,}/g, '/c/[redacted]');
  // Opaque capability tokens are URL-safe base64 without padding (~43 chars for 32 bytes).
  result = result.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
  return result;
}

export function assertNoRawCapabilityToken(
  value: unknown,
  rawToken: string,
  context: string,
): void {
  if (!rawToken) {
    return;
  }
  const serialized =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value);
  if (serialized.includes(rawToken)) {
    throw new Error(`Raw capability token must not appear in ${context}.`);
  }
}
