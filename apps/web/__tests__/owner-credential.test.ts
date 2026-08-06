import { describe, expect, it } from 'vitest';
import { parseBearerAccessToken } from '@/lib/auth/owner-credential';

describe('parseBearerAccessToken', () => {
  it('extracts a well-formed Bearer access token', () => {
    expect(parseBearerAccessToken('Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature')).toBe(
      'eyJhbGciOiJIUzI1NiJ9.e30.signature',
    );
  });

  it('is case-insensitive on the Bearer scheme', () => {
    expect(parseBearerAccessToken('bearer token-value')).toBe('token-value');
  });

  it('rejects missing, empty, and non-Bearer headers', () => {
    expect(parseBearerAccessToken(null)).toBeNull();
    expect(parseBearerAccessToken('')).toBeNull();
    expect(parseBearerAccessToken('Basic abc')).toBeNull();
    expect(parseBearerAccessToken('Bearer')).toBeNull();
    expect(parseBearerAccessToken('Bearer ')).toBeNull();
  });
});
