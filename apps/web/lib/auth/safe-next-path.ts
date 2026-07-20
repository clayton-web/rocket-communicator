/**
 * Allowlist a relative return path for post-login redirects.
 * Same rules as Gmail OAuth return paths: same-origin absolute path only.
 * Safe for both server and client modules (no Node-only deps).
 */
export function resolveSafeNextPath(candidate: string | null | undefined, fallback = '/'): string {
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
  // Reject protocol-looking schemes smuggled after the slash.
  if (candidate.includes(':')) {
    return fallback;
  }
  return candidate;
}
