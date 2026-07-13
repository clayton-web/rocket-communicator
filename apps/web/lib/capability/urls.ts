/**
 * Relative browser path for OpenAPI IssuedCapabilityLink.capabilityPath (D063).
 */
export function buildCapabilityPath(rawToken: string): string {
  return `/c/${rawToken}`;
}

/**
 * Build the absolute browser capability view URL (`/c/{token}`).
 * Callers that log or audit must redact with `redactCapabilitySecrets`.
 */
export function buildCapabilityUrl(appUrl: string, rawToken: string): string {
  const base = appUrl.replace(/\/$/, '');
  return `${base}${buildCapabilityPath(rawToken)}`;
}
