// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  authorizeCronRequest,
  getCronSecretFromEnv,
  timingSafeEqualString,
} from '@/lib/gmail/cron-auth';

const SECRET = 'cron-secret-value-at-least-32-chars!!';

function requestWithAuth(header: string | null | undefined, extra?: HeadersInit): Request {
  const headers = new Headers(extra);
  if (header != null) {
    headers.set('authorization', header);
  }
  return new Request('http://localhost/api/v1/internal/gmail/poll', {
    method: 'GET',
    headers,
  });
}

describe('A5.5 cron auth', () => {
  it('reads CRON_SECRET and rejects empty/missing', () => {
    expect(getCronSecretFromEnv({ CRON_SECRET: SECRET })).toBe(SECRET);
    expect(getCronSecretFromEnv({ CRON_SECRET: '' })).toBeNull();
    expect(getCronSecretFromEnv({})).toBeNull();
  });

  it('compares equal secrets in constant-time helper', () => {
    expect(timingSafeEqualString(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualString(SECRET, 'wrong-secret-value-xxxxxxxxxxxxxxx')).toBe(false);
    expect(timingSafeEqualString('short', SECRET)).toBe(false);
  });

  it('accepts a valid Bearer secret', () => {
    const result = authorizeCronRequest(requestWithAuth(`Bearer ${SECRET}`), {
      CRON_SECRET: SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it('returns 500 when CRON_SECRET is not configured', () => {
    const result = authorizeCronRequest(requestWithAuth(`Bearer ${SECRET}`), {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.code).toBe('configuration_error');
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it('rejects missing Authorization', () => {
    const result = authorizeCronRequest(requestWithAuth(null), { CRON_SECRET: SECRET });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('unauthorized');
    }
  });

  it('rejects malformed Authorization and wrong scheme', () => {
    expect(authorizeCronRequest(requestWithAuth('Bearer'), { CRON_SECRET: SECRET }).ok).toBe(false);
    expect(
      authorizeCronRequest(requestWithAuth(`Basic ${SECRET}`), { CRON_SECRET: SECRET }).ok,
    ).toBe(false);
    expect(
      authorizeCronRequest(requestWithAuth(`bearer ${SECRET}`), { CRON_SECRET: SECRET }).ok,
    ).toBe(false);
  });

  it('rejects wrong secret without echoing it', () => {
    const result = authorizeCronRequest(requestWithAuth('Bearer totally-wrong-secret-value'), {
      CRON_SECRET: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.message).toBe('Unauthorized.');
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain('totally-wrong');
    }
  });

  it('rejects empty bearer token', () => {
    const result = authorizeCronRequest(requestWithAuth('Bearer  '), { CRON_SECRET: SECRET });
    expect(result.ok).toBe(false);
  });
});
