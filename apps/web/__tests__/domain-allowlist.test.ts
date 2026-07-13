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

  it('accepts top-level identity_data.hd', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
      hostedDomainLocation: 'top_level',
    });

    expect(extractHostedDomain(user)).toBe('example.com');
  });

  it('accepts identity_data.custom_claims.hd from the live Supabase shape', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
      hostedDomainLocation: 'custom_claims',
    });

    expect(extractHostedDomain(user)).toBe('example.com');
    expect(workspaceIdentityFromUser(user).hostedDomain).toBe('example.com');
  });

  it('normalizes custom_claims.hd case and whitespace during comparison', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: '  Example.COM  ',
      hostedDomainLocation: 'custom_claims',
    });

    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: true,
    });
  });

  it('prefers top-level identity_data.hd when both hd locations are present', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'example.com',
      hostedDomainLocation: 'both',
    });
    user.identities![0]!.identity_data = {
      ...user.identities![0]!.identity_data,
      hd: 'example.com',
      custom_claims: { hd: 'other.com' },
    };

    expect(extractHostedDomain(user)).toBe('example.com');
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: true,
    });
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'other.com')).toEqual({
      permitted: false,
      reason: 'email_domain_mismatch',
    });
  });

  it('rejects when both verified hd locations are missing', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: null,
      hostedDomainLocation: 'none',
    });

    expect(extractHostedDomain(user)).toBeNull();
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: false,
      reason: 'missing_hosted_domain',
    });
  });

  it('rejects malformed custom_claims safely', () => {
    for (const customClaims of [null, [], 'invalid', { hd: 123 }, { hd: '   ' }]) {
      const user = createGoogleSupabaseUser({
        email: 'owner@example.com',
        hostedDomain: null,
        hostedDomainLocation: 'none',
      });
      user.identities![0]!.identity_data = {
        ...user.identities![0]!.identity_data,
        custom_claims: customClaims,
      };

      expect(extractHostedDomain(user)).toBeNull();
    }
  });

  it('rejects custom_claims.hd mismatch with hosted_domain_mismatch', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: 'other.com',
      hostedDomainLocation: 'custom_claims',
    });

    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: false,
      reason: 'hosted_domain_mismatch',
    });
  });

  it('ignores user_metadata.custom_claims.hd', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@example.com',
      hostedDomain: null,
      hostedDomainLocation: 'none',
      includeUserMetadataCustomClaimsHd: true,
    });

    expect(extractHostedDomain(user)).toBeNull();
    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: false,
      reason: 'missing_hosted_domain',
    });
  });

  it('rejects personal Gmail accounts without a verified hd claim', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@gmail.com',
      hostedDomain: null,
      hostedDomainLocation: 'none',
    });

    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: false,
      reason: 'email_domain_mismatch',
    });
  });

  it('rejects email-domain mismatch even when hd matches', () => {
    const user = createGoogleSupabaseUser({
      email: 'owner@other.com',
      hostedDomain: 'example.com',
      hostedDomainLocation: 'custom_claims',
    });

    expect(isWorkspaceDomainPermitted(workspaceIdentityFromUser(user), 'example.com')).toEqual({
      permitted: false,
      reason: 'email_domain_mismatch',
    });
  });
});
