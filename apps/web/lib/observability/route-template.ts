/**
 * Convert a URL pathname (or accidental absolute URL / query-bearing string)
 * into a privacy-safe route template (D114).
 *
 * Capability tokens in `/c/{token}` and `/api/v1/capabilities/{token}/…` are
 * replaced wherever they appear. Query strings and fragments are stripped.
 * Prefer passing literal templates from call sites; this scrubber is defense in depth.
 */
export function toSafeRouteTemplate(pathname: string): string {
  let result = pathname.trim();

  // Absolute URLs: keep pathname (+ optional search stripped below).
  try {
    if (/^https?:\/\//i.test(result)) {
      const url = new URL(result);
      result = url.pathname;
    }
  } catch {
    // Keep original; subsequent scrubbers still apply.
  }

  // Drop query/hash if a caller passed a request URL fragment.
  const queryIndex = result.search(/[?#]/);
  if (queryIndex >= 0) {
    result = result.slice(0, queryIndex);
  }

  // Browser capability page: /c/{token}[…] (also mid-string / absolute leftovers)
  result = result.replace(/\/c\/[^/]+/g, '/c/[token]');

  // Recipient capability API: /api/v1/capabilities/{token}/…
  result = result.replace(/(\/api\/v1\/capabilities\/)[^/]+/g, '$1[token]');

  // Task id segments (stable resource ids — not secrets, but keep templates consistent)
  result = result.replace(/(\/tasks\/)[^/]+/g, '$1[taskId]');
  result = result.replace(/(\/task-suggestions\/)[^/]+/g, '$1[suggestionId]');
  result = result.replace(/(\/recipients\/)[^/]+/g, '$1[recipientId]');

  return result;
}

/** True when the path is a capability browser page or capability API route. */
export function isCapabilityPath(pathname: string): boolean {
  const safe = toSafeRouteTemplate(pathname);
  return safe.startsWith('/c/') || safe.includes('/api/v1/capabilities/');
}
