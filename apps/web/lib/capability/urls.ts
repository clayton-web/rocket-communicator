/**
 * Build the browser capability view URL (`/c/{token}`).
 * Callers that log or audit must redact with `redactCapabilitySecrets`.
 */
export function buildCapabilityUrl(appUrl: string, rawToken: string): string {
  const base = appUrl.replace(/\/$/, '');
  return `${base}/c/${rawToken}`;
}
