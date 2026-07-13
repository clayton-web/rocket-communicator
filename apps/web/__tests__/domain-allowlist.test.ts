import { describe, expect, it } from 'vitest';
import {
  extractEmailDomain,
  extractHostedDomain,
  isWorkspaceDomainPermitted,
  normalizeDomain,
  workspaceIdentityFromUser,
} from '@/lib/auth/domain-allowlist';
import { createGoogleSupabaseUser } from './fixtures/supabase-user';

describe('domain allowlist', () => {
  it('normalizes domains case-insensitively', () => {
    expect(normalizeDomain(' Example.COM ')).toBe('example.com');
    expect(normalizeDomain('@example.com')).toBe('example.com');
  });

  it('permits matching hosted domain and email domain', () => {
    const result = isWorkspaceDomainPermitted(
      { email: 'owner@example.com', hostedDomain: 'example.com' },
      'example.com',
    );
    expect(result).toEqual({ permitted: true });
  });

  it('rejects mismatched hosted domain', () => {
    const result = isWorkspaceDomainPermitted(
      { email: 'owner@example.com', hostedDomain: 'other.com' },
      'example.com',
    );
    expect(result.permitted).toBe(false);
    expect(result.reason).toBe('hosted_domain_mismatch');
  });

  it('rejects mismatched email domain even when hosted domain matches', () => {
    const result = isWorkspaceDomainPermitted(
      { email: 'owner@other.com', hostedDomain: 'example.com' },
      'example.com',
    );
    expect(result).toEqual({ permitted: false, reason: 'email_domain_mismatch' });
  });

  it('rejects mismatched email domain', () => {
    const result = isWorkspaceDomainPermitted(
      { email: 'owner@other.com', hostedDomain: 'other.com' },
      'example.com',
    );
    expect(result.permitted).toBe(false);
    expect(result.reason).toBe('email_domain_mismatch');
  });

  it('rejects malformed or missing email', () => {
    expect(
      isWorkspaceDomainPermitted(
        { email: 'not-an-email', hostedDomain: 'example.com' },
        'example.com',
      ),
    ).toEqual({ permitted: false, reason: 'malformed_email' });
    expect(
      isWorkspaceDomainPermitted({ email: '', hostedDomain: 'example.com' }, 'example.com'),
    ).toEqual({ permitted: false, reason: 'missing_email' });
  });

  it('rejects missing hosted domain claim', () => {
    const result = isWorkspaceDomainPermitted({ email: 'owner@example.com' }, 'example.com');
    expect(result).toEqual({ permitted: false, reason: 'missing_hosted_domain' });
  });

  it('extracts email domains safely', () => {
    expect(extractEmailDomain('owner@Example.COM')).toBe('example.com');
    expect(extractEmailDomain('invalid')).toBeNull();
  });

  it('reads hosted domain from verified Google identity_data', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
    });

    expect(extractHostedDomain(user)).toBe('example.com');
    expect(workspaceIdentityFromUser(user).hostedDomain).toBe('example.com');
  });

  it('ignores user_metadata.hd when identity_data.hd is absent', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: null,
      includeUserMetadataHd: true,
    });

    expect(extractHostedDomain(user)).toBeNull();
  });

  it('ignores spoofed user_metadata.hd when identity_data.hd mismatches', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
    });
    user.user_metadata = { ...user.user_metadata, hd: 'attacker.com' };

    expect(extractHostedDomain(user)).toBe('example.com');
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: true,
    });
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'attacker.com')).toEqual({
      permitted: false,
      reason: 'email_domain_mismatch',
    });
  });
});
