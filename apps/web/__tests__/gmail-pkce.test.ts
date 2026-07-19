// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generateStateToken,
  hashOAuthState,
  PKCE_CODE_CHALLENGE_METHOD,
} from '@/lib/gmail/pkce';
import { resolveSafeReturnPath } from '@/lib/gmail/safe-redirect';
import { GMAIL_OAUTH_SCOPES, buildGmailAuthUrl } from '@/lib/gmail/oauth-client';
import { GMAIL_READONLY_SCOPE } from '@aicaa/domain';

describe('Gmail PKCE, state hashing, and return-path allowlist', () => {
  it('generates unguessable state tokens with at least 256 bits of entropy', () => {
    const a = generateStateToken();
    const b = generateStateToken();
    expect(a).not.toBe(b);
    // 32 random bytes → base64url ≈ 43 chars
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('hashes OAuth state deterministically with SHA-256 hex', () => {
    const raw = 'oauth-state-raw-value';
    const expected = createHash('sha256').update(raw, 'utf8').digest('hex');
    expect(hashOAuthState(raw)).toBe(expected);
    expect(hashOAuthState(raw)).toBe(hashOAuthState(raw));
    expect(hashOAuthState(raw)).not.toBe(raw);
  });

  it('produces an S256 code challenge from the verifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);
    expect(PKCE_CODE_CHALLENGE_METHOD).toBe('S256');
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('allowlists only same-origin absolute paths', () => {
    expect(resolveSafeReturnPath('/settings/gmail', '/fallback')).toBe('/settings/gmail');
    expect(resolveSafeReturnPath('https://evil.example/phish', '/fallback')).toBe('/fallback');
    expect(resolveSafeReturnPath('//evil.example/phish', '/fallback')).toBe('/fallback');
    expect(resolveSafeReturnPath('/\\evil', '/fallback')).toBe('/fallback');
    expect(resolveSafeReturnPath(null, '/fallback')).toBe('/fallback');
  });

  it('requests offline access, consent, readonly + send (A7.4), and incremental scopes', () => {
    // A7.4: send scope is added for outbound handoff; modify/compose/full-mailbox stay excluded.
    expect(GMAIL_OAUTH_SCOPES).toContain(GMAIL_READONLY_SCOPE);
    expect(GMAIL_OAUTH_SCOPES.join(' ')).toContain('gmail.send');
    expect(GMAIL_OAUTH_SCOPES.join(' ')).not.toMatch(/gmail\.(modify|compose)/);
    expect(GMAIL_OAUTH_SCOPES.join(' ')).not.toContain('https://mail.google.com/');

    const url = new URL(
      buildGmailAuthUrl({
        state: 'state_test',
        codeChallenge: 'challenge_test',
        config: {
          clientId: 'cid',
          clientSecret: 'csecret',
          redirectUrl: 'http://localhost:3000/api/v1/gmail/oauth/callback',
          appUrl: 'http://localhost:3000',
          ownerWorkspaceDomain: 'example.com',
          ownerOrganizationId: 'org_test',
        },
      }),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge_test');
    expect(url.searchParams.get('state')).toBe('state_test');
    // Incremental authorization lets an existing read-only Owner add send without a hard reconnect.
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('scope')).toContain(GMAIL_READONLY_SCOPE);
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    expect(url.searchParams.get('scope')).not.toMatch(/gmail\.(modify|compose)/);
  });
});
