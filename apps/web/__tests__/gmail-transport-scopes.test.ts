// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE } from '@aicaa/domain';
import {
  GMAIL_OAUTH_SCOPES,
  GMAIL_READONLY_OAUTH_SCOPES,
  buildGmailAuthUrl,
  buildGmailSendConsentAuthUrl,
} from '@/lib/gmail/oauth-client';
import {
  deriveGmailConnectionFacts,
  hasGmailSendScope,
  parseGrantedScopes,
} from '@/lib/gmail/transport/scopes';
import {
  evaluateGmailSendCapability,
  evaluateGmailSendCapabilityFromStored,
} from '@/lib/gmail/transport/send-capability';
import { mapConnectionToDto, notConnectedDto } from '@/lib/gmail/connection-dto';
import type { CommunicationAccount } from '@aicaa/domain';

const FAKE_CONFIG = {
  clientId: 'fake-client-id',
  clientSecret: 'fake-secret',
  redirectUrl: 'https://app.example.com/api/v1/gmail/oauth/callback',
  appUrl: 'https://app.example.com',
  ownerWorkspaceDomain: 'example.com',
  ownerOrganizationId: 'org_1',
};

const READONLY_GRANT = `openid email ${GMAIL_READONLY_SCOPE}`;
const SEND_GRANT = `openid email ${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`;

function connectedAccount(): CommunicationAccount {
  return {
    id: 'acct_1' as CommunicationAccount['id'],
    organizationId: 'org_1' as CommunicationAccount['organizationId'],
    provider: 'gmail',
    emailAddress: 'owner@example.com',
    externalAccountId: 'ext_1',
    status: 'connected',
    historyId: '123',
    historyState: 'valid',
    connectedAt: '2026-01-01T00:00:00.000Z' as CommunicationAccount['connectedAt'],
    disconnectedAt: null,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    syncLockUntil: null,
  };
}

describe('A7.4 OAuth send scope set', () => {
  it('requests the minimum send scope alongside readonly + identity', () => {
    expect(GMAIL_OAUTH_SCOPES).toContain('openid');
    expect(GMAIL_OAUTH_SCOPES).toContain('email');
    expect(GMAIL_OAUTH_SCOPES).toContain(GMAIL_READONLY_SCOPE);
    expect(GMAIL_OAUTH_SCOPES).toContain(GMAIL_SEND_SCOPE);
  });

  it('never requests gmail.modify, compose, full-mailbox, or contacts scopes', () => {
    const joined = GMAIL_OAUTH_SCOPES.join(' ');
    expect(joined).not.toContain('gmail.modify');
    expect(joined).not.toContain('gmail.compose');
    expect(joined).not.toContain('https://mail.google.com/');
    expect(joined).not.toContain('contacts');
  });

  it('keeps a readonly-only scope set for A5-compatible re-consent', () => {
    expect(GMAIL_READONLY_OAUTH_SCOPES).toContain(GMAIL_READONLY_SCOPE);
    expect(GMAIL_READONLY_OAUTH_SCOPES).not.toContain(GMAIL_SEND_SCOPE);
  });

  it('builds an incremental-consent auth URL requesting only the needed scopes', () => {
    const url = buildGmailAuthUrl({
      state: 'state123',
      codeChallenge: 'challenge123',
      config: FAKE_CONFIG,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('include_granted_scopes')).toBe('true');
    const scopeParam = parsed.searchParams.get('scope') ?? '';
    expect(scopeParam).toContain(GMAIL_SEND_SCOPE);
    expect(scopeParam).toContain(GMAIL_READONLY_SCOPE);
    expect(scopeParam).not.toContain('gmail.modify');
    expect(scopeParam).not.toContain('gmail.compose');
  });

  it('send-consent URL uses the full send scope set incrementally', () => {
    const url = buildGmailSendConsentAuthUrl({
      state: 's',
      codeChallenge: 'c',
      config: FAKE_CONFIG,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('include_granted_scopes')).toBe('true');
    expect(parsed.searchParams.get('scope') ?? '').toContain(GMAIL_SEND_SCOPE);
  });
});

describe('A7.4 granted-scope parsing', () => {
  it('parses a read-only grant as readable but not send-capable', () => {
    const parsed = parseGrantedScopes(READONLY_GRANT);
    expect(parsed.canRead).toBe(true);
    expect(parsed.canSend).toBe(false);
    expect(hasGmailSendScope(READONLY_GRANT)).toBe(false);
  });

  it('parses a send grant as send-capable', () => {
    const parsed = parseGrantedScopes(SEND_GRANT);
    expect(parsed.canRead).toBe(true);
    expect(parsed.canSend).toBe(true);
    expect(hasGmailSendScope(SEND_GRANT)).toBe(true);
  });

  it('treats null/empty grants as non-capable', () => {
    expect(hasGmailSendScope(null)).toBe(false);
    expect(hasGmailSendScope('')).toBe(false);
    expect(parseGrantedScopes(undefined).canRead).toBe(false);
  });

  it('derives requiresSendReconsent for connected read-only grants', () => {
    const facts = deriveGmailConnectionFacts({ connected: true, grantedScopes: READONLY_GRANT });
    expect(facts.connected).toBe(true);
    expect(facts.canRead).toBe(true);
    expect(facts.canSend).toBe(false);
    expect(facts.requiresSendReconsent).toBe(true);
  });
});

describe('A7.4 send-capability prerequisite', () => {
  it('reports not_connected when there is no connection', () => {
    const result = evaluateGmailSendCapabilityFromStored({
      connected: false,
      grantedScopes: null,
    });
    expect(result.state).toBe('not_connected');
    expect(result.prerequisite.ok).toBe(false);
    if (!result.prerequisite.ok) {
      expect(result.prerequisite.failure.code).toBe('GMAIL_NOT_CONNECTED');
    }
  });

  it('reports send_scope_required for a connected read-only grant (typed, not raw)', () => {
    const result = evaluateGmailSendCapabilityFromStored({
      connected: true,
      grantedScopes: READONLY_GRANT,
    });
    expect(result.state).toBe('send_scope_required');
    expect(result.facts.requiresSendReconsent).toBe(true);
    expect(result.prerequisite.ok).toBe(false);
    if (!result.prerequisite.ok) {
      expect(result.prerequisite.failure.code).toBe('GMAIL_SEND_SCOPE_REQUIRED');
      expect(result.prerequisite.failure.category).toBe('authorization');
    }
  });

  it('reports send_available for a connected send grant', () => {
    const result = evaluateGmailSendCapabilityFromStored({
      connected: true,
      grantedScopes: SEND_GRANT,
    });
    expect(result.state).toBe('send_available');
    expect(result.prerequisite.ok).toBe(true);
  });

  it('evaluates directly from facts too', () => {
    const result = evaluateGmailSendCapability({
      connected: true,
      canRead: true,
      canSend: true,
      requiresSendReconsent: false,
    });
    expect(result.state).toBe('send_available');
  });
});

describe('A7.4 connection DTO send-capability wiring', () => {
  it('does not report a read-only connection as send-capable', () => {
    const dto = mapConnectionToDto(connectedAccount(), { grantedScopes: READONLY_GRANT });
    expect(dto.canRead).toBe(true);
    expect(dto.canSend).toBe(false);
    expect(dto.requiresSendReconsent).toBe(true);
  });

  it('reports a send grant as send-capable', () => {
    const dto = mapConnectionToDto(connectedAccount(), { grantedScopes: SEND_GRANT });
    expect(dto.canSend).toBe(true);
    expect(dto.requiresSendReconsent).toBe(false);
  });

  it('omits nothing dangerous and keeps A5 defaults when scopes are not supplied', () => {
    const dto = mapConnectionToDto(connectedAccount());
    expect(dto.readonlyScope).toBe(true);
    expect(dto.canSend).toBeUndefined();
    const none = notConnectedDto();
    expect(none.canSend).toBe(false);
  });
});
