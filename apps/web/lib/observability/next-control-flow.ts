/**
 * Detect Next.js App Router control-flow throws (redirect / not-found).
 * These must not be recorded as operational failures or error timings (P1.1).
 *
 * Uses digest prefixes rather than deep `next/dist` imports so the check stays
 * stable across bundling and does not pull client navigation internals into
 * every server module graph.
 */
export function isNextControlFlowError(error: unknown): boolean {
  const digest = readDigest(error);
  if (!digest) {
    return false;
  }
  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK');
}

/** True when the control-flow error represents a not-found (HTTP 404) fallback. */
export function isNextNotFoundControlFlowError(error: unknown): boolean {
  const digest = readDigest(error);
  return typeof digest === 'string' && digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404');
}

function readDigest(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  try {
    const digest = Reflect.get(error, 'digest');
    return typeof digest === 'string' && digest.length > 0 ? digest : undefined;
  } catch {
    return undefined;
  }
}
