import 'server-only';

/**
 * Allowlist a caller-provided return path. Only same-origin absolute paths are permitted;
 * protocol-relative (`//host`), absolute URLs, backslashes, and control characters are rejected
 * to prevent open redirects. Anything unsafe falls back to the default.
 */
export function resolveSafeReturnPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate) {
    return fallback;
  }
  if (!candidate.startsWith('/')) {
    return fallback;
  }
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }
  if (/[\u0000-\u001f\\]/.test(candidate)) {
    return fallback;
  }
  return candidate;
}

/**
 * Build an absolute, same-origin redirect URL from an allowlisted return path plus a single
 * safe status query parameter. Never carries tokens, codes, state, or raw provider errors.
 */
export function buildReturnUrl(
  appUrl: string,
  returnPath: string,
  status: { key: string; value: string },
): URL {
  const base = new URL(returnPath, `${appUrl}/`);
  base.searchParams.set(status.key, status.value);
  return base;
}
