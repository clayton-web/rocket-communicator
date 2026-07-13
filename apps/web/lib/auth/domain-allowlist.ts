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

/**
 * Google Workspace hosted domain from Supabase's verified Google provider identity.
 *
 * Supabase Auth validates the Google ID token server-side during OAuth and persists the
 * verified `hd` claim on `identities[].identity_data` for provider `google`. That field is
 * returned by `auth.getUser()` and is the enforcement source. `user_metadata.hd` is not
 * trusted because it is not a verified authorization claim.
 */
export function extractHostedDomain(user: User): string | null {
  const googleIdentity = user.identities?.find((identity) => identity.provider === 'google');
  const identityData = googleIdentity?.identity_data;
  if (identityData && typeof identityData.hd === 'string' && identityData.hd.trim()) {
    return identityData.hd;
  }

  return null;
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
