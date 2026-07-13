import type { User } from '@supabase/supabase-js';

export interface WorkspaceIdentity {
  email: string;
  hostedDomain?: string | null;
}

export type DomainAllowlistFailureReason =
  | 'missing_allowed_domain'
  | 'missing_email'
  | 'malformed_email'
  | 'email_domain_mismatch'
  | 'hosted_domain_mismatch'
  | 'missing_hosted_domain';

export interface DomainAllowlistResult {
  permitted: boolean;
  reason?: DomainAllowlistFailureReason;
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, '');
}

export function extractEmailDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }
  return normalizeDomain(trimmed.slice(at + 1));
}

export function workspaceIdentityFromUser(user: User): WorkspaceIdentity {
  return {
    email: user.email ?? '',
    hostedDomain: extractHostedDomain(user),
  };
}

function readHostedDomainClaim(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readHostedDomainFromCustomClaims(customClaims: unknown): string | null {
  if (!customClaims || typeof customClaims !== 'object' || Array.isArray(customClaims)) {
    return null;
  }

  return readHostedDomainClaim((customClaims as Record<string, unknown>).hd);
}

function readHostedDomainFromIdentityData(identityData: unknown): string | null {
  if (!identityData || typeof identityData !== 'object' || Array.isArray(identityData)) {
    return null;
  }

  const data = identityData as Record<string, unknown>;
  const topLevelHd = readHostedDomainClaim(data.hd);
  if (topLevelHd) {
    return topLevelHd;
  }

  return readHostedDomainFromCustomClaims(data.custom_claims);
}

/**
 * Google Workspace hosted domain from Supabase's verified Google provider identity.
 *
 * Supabase Auth validates the Google ID token server-side during OAuth and persists the
 * verified `hd` claim on `identities[].identity_data` for provider `google`, either as
 * `identity_data.hd` or `identity_data.custom_claims.hd`. That identity data is returned
 * by `auth.getUser()` and is the enforcement source. `user_metadata` is not trusted.
 */
export function extractHostedDomain(user: User): string | null {
  const googleIdentity = user.identities?.find((identity) => identity.provider === 'google');
  return readHostedDomainFromIdentityData(googleIdentity?.identity_data);
}

export function isWorkspaceDomainPermitted(
  identity: WorkspaceIdentity,
  allowedDomain: string,
): DomainAllowlistResult {
  const allowed = normalizeDomain(allowedDomain);
  if (!allowed) {
    return { permitted: false, reason: 'missing_allowed_domain' };
  }

  if (!identity.email?.trim()) {
    return { permitted: false, reason: 'missing_email' };
  }

  const emailDomain = extractEmailDomain(identity.email);
  if (!emailDomain) {
    return { permitted: false, reason: 'malformed_email' };
  }

  if (emailDomain !== allowed) {
    return { permitted: false, reason: 'email_domain_mismatch' };
  }

  if (!identity.hostedDomain?.trim()) {
    return { permitted: false, reason: 'missing_hosted_domain' };
  }

  const hostedDomain = normalizeDomain(identity.hostedDomain);
  if (hostedDomain !== allowed) {
    return { permitted: false, reason: 'hosted_domain_mismatch' };
  }

  return { permitted: true };
}
