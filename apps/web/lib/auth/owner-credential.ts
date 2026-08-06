import { headers } from 'next/headers';

/**
 * Owner credential extraction (A9.0 / D145).
 *
 * Supplies the credential for the single shared Owner authentication pipeline:
 * - Prefer `Authorization: Bearer <supabase_access_jwt>` when present and well-formed.
 * - Otherwise fall through to the SSR cookie session (existing web path).
 *
 * This is not cron auth. Owner JWTs must never be compared to `CRON_SECRET`.
 * Multiple or malformed Authorization headers are treated as "no Bearer" so the
 * cookie path can still succeed for same-origin browser requests that happen to
 * carry unrelated Authorization noise — a single well-formed Bearer is required
 * to take the JWT path.
 */

export type OwnerCredential = { kind: 'bearer'; accessToken: string } | { kind: 'cookie' };

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Parse a Bearer access token from an Authorization header value.
 * Returns null when the value is missing or not a single Bearer token.
 */
export function parseBearerAccessToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const trimmed = authorizationHeader.trim();
  if (!trimmed) {
    return null;
  }

  const match = BEARER_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Resolve the Owner credential for the current request.
 * Reads `Authorization` from Next.js request headers when available.
 */
export async function extractOwnerCredential(): Promise<OwnerCredential> {
  let authorization: string | null = null;
  try {
    const headerStore = await headers();
    authorization = headerStore.get('authorization');
  } catch {
    // Outside a request context (some tests / scripts): cookie path only.
    return { kind: 'cookie' };
  }

  const accessToken = parseBearerAccessToken(authorization);
  if (accessToken) {
    return { kind: 'bearer', accessToken };
  }

  return { kind: 'cookie' };
}
