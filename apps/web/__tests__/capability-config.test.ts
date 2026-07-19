// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITY_TTL_MS } from '@aicaa/domain';
import {
  DOCUMENTED_DEFAULT_CAPABILITY_TTL_MS,
  MAX_CAPABILITY_TTL_MS,
  MIN_CAPABILITY_TTL_MS,
  CapabilityTokenError,
  assertValidCapabilityTtlMs,
  getCapabilityTokenConfig,
  parseCapabilityTtlMs,
} from '@/lib/capability/config';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function setValidEnv(overrides: Record<string, string> = {}) {
  process.env.CAPABILITY_TOKEN_PEPPER = 'p'.repeat(32);
  process.env.CAPABILITY_TTL_MS = String(DEFAULT_CAPABILITY_TTL_MS);
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  Object.assign(process.env, overrides);
}

describe('capability token configuration', () => {
  it('loads valid seven-day configuration', () => {
    setValidEnv();
    const config = getCapabilityTokenConfig();
    expect(config.ttlMs).toBe(DEFAULT_CAPABILITY_TTL_MS);
    expect(config.ttlMs).toBe(DOCUMENTED_DEFAULT_CAPABILITY_TTL_MS);
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.pepper).toHaveLength(32);
  });

  it('rejects missing pepper', () => {
    setValidEnv();
    delete process.env.CAPABILITY_TOKEN_PEPPER;
    expect(() => getCapabilityTokenConfig()).toThrow(CapabilityTokenError);
    expect(() => getCapabilityTokenConfig()).toThrow(/CAPABILITY_TOKEN_PEPPER/);
  });

  it('rejects short pepper', () => {
    setValidEnv({ CAPABILITY_TOKEN_PEPPER: 'too-short' });
    expect(() => getCapabilityTokenConfig()).toThrow(/at least 32/);
  });

  it('rejects missing TTL', () => {
    setValidEnv();
    delete process.env.CAPABILITY_TTL_MS;
    expect(() => getCapabilityTokenConfig()).toThrow(/CAPABILITY_TTL_MS/);
  });

  it('rejects zero, negative, malformed, and excessive TTL', () => {
    expect(() => parseCapabilityTtlMs('0')).toThrow(CapabilityTokenError);
    expect(() => parseCapabilityTtlMs('-1')).toThrow(CapabilityTokenError);
    expect(() => parseCapabilityTtlMs('abc')).toThrow(CapabilityTokenError);
    expect(() => assertValidCapabilityTtlMs(MIN_CAPABILITY_TTL_MS - 1)).toThrow(
      CapabilityTokenError,
    );
    expect(() => assertValidCapabilityTtlMs(MAX_CAPABILITY_TTL_MS + 1)).toThrow(
      CapabilityTokenError,
    );
  });

  it('23. capability base URL is server-controlled configuration (env), normalized', () => {
    setValidEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example.com/' });
    const config = getCapabilityTokenConfig();
    // Trailing slash normalized; value is the trusted env base, never a request host.
    expect(config.appUrl).toBe('https://app.example.com');
  });

  it('24. rejects unsafe/non-HTTPS capability origin in production and malformed URLs', () => {
    // Non-absolute / malformed base URL is always rejected.
    setValidEnv({ NEXT_PUBLIC_APP_URL: 'not-a-url' });
    expect(() => getCapabilityTokenConfig()).toThrow(/absolute http/);

    // Credentials / query / fragment in the base are rejected (open-redirect / token misplacement).
    setValidEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example.com/?next=evil' });
    expect(() => getCapabilityTokenConfig()).toThrow(CapabilityTokenError);

    // In production, plain http is rejected; https is accepted.
    setValidEnv({ NEXT_PUBLIC_APP_URL: 'http://app.example.com', NODE_ENV: 'production' });
    expect(() => getCapabilityTokenConfig()).toThrow(/https in production/);

    setValidEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example.com', NODE_ENV: 'production' });
    expect(getCapabilityTokenConfig().appUrl).toBe('https://app.example.com');
  });

  it('does not expose pepper through public NEXT_PUBLIC configuration names', () => {
    setValidEnv();
    const config = getCapabilityTokenConfig();
    expect(
      Object.keys(process.env).some(
        (key) => key.startsWith('NEXT_PUBLIC_') && key.includes('PEPPER'),
      ),
    ).toBe(false);
    expect(config).toHaveProperty('pepper');
    expect(process.env.NEXT_PUBLIC_CAPABILITY_TOKEN_PEPPER).toBeUndefined();
  });
});
