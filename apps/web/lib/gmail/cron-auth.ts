import 'server-only';
import { timingSafeEqual } from 'node:crypto';

export type CronAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 500;
      code: 'unauthorized' | 'configuration_error';
      message: string;
    };

/** Read CRON_SECRET from env. Returns null when missing or empty. Never logs the value. */
export function getCronSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.CRON_SECRET;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Constant-time string compare. When lengths differ, still runs timingSafeEqual against a
 * same-length dummy buffer so early length mismatch does not short-circuit comparison work.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    const dummy = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, dummy);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function collectAuthorizationHeaders(request: Request): string[] {
  const values: string[] = [];
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'authorization') {
      // Headers may join duplicates with ", " for some runtimes; split conservatively.
      for (const part of value.split(/,(?=\s*Bearer\s|\s*[A-Za-z]+\s)/i)) {
        const trimmed = part.trim();
        if (trimmed) {
          values.push(trimmed);
        }
      }
    }
  });
  return values;
}

/**
 * Authorize an internal cron request via Authorization: Bearer <CRON_SECRET>.
 * No Owner session fallback. Never logs secrets.
 */
export function authorizeCronRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): CronAuthResult {
  const secret = getCronSecretFromEnv(env);
  if (secret == null) {
    return {
      ok: false,
      status: 500,
      code: 'configuration_error',
      message: 'Cron authentication is not configured.',
    };
  }

  const authHeaders = collectAuthorizationHeaders(request);
  if (authHeaders.length !== 1) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized.',
    };
  }

  const header = authHeaders[0]!;
  const match = /^Bearer\s+(\S+)$/.exec(header);
  if (!match) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized.',
    };
  }

  const token = match[1]!;
  if (!timingSafeEqualString(token, secret)) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized.',
    };
  }

  return { ok: true };
}
