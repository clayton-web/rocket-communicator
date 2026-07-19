import 'server-only';
import { DEFAULT_GMAIL_POLL_INTERVAL_MINUTES, type CommunicationAccount } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';
import { deriveGmailConnectionFacts } from './transport/scopes';

export type GmailConnectionDto = components['schemas']['GmailConnection'];

/**
 * A7.4 send-capability facts for the DTO. When the caller has loaded the stored granted-scope
 * string it can pass it here so the DTO emits the contract's optional `canRead` / `canSend` /
 * `requiresSendReconsent` booleans (D093). When omitted, the DTO keeps A5 behavior and only sets
 * `readonlyScope`, so existing read-only connections are never implicitly reported as send-capable.
 */
export interface GmailConnectionScopeInput {
  grantedScopes: string | null | undefined;
}

/**
 * Safe Owner-facing connection DTO. Only operational, non-secret fields are exposed.
 * Tokens, ciphertext, key versions, OAuth codes, state, and PKCE material are never included
 * because the source `CommunicationAccount` domain object does not carry them.
 */
export function notConnectedDto(): GmailConnectionDto {
  return {
    status: 'not_connected',
    provider: 'gmail',
    historyState: 'unset',
    pollingIntervalMinutes: DEFAULT_GMAIL_POLL_INTERVAL_MINUTES,
    inboxOnly: true,
    readonlyScope: true,
    canRead: false,
    canSend: false,
    requiresSendReconsent: false,
  };
}

export function mapConnectionToDto(
  account: CommunicationAccount | null,
  scope?: GmailConnectionScopeInput,
): GmailConnectionDto {
  if (!account) {
    return notConnectedDto();
  }
  const dto: GmailConnectionDto = {
    status: account.status,
    provider: 'gmail',
    emailAddress: account.emailAddress,
    connectedAt: account.connectedAt ?? undefined,
    lastSyncAt: account.lastSyncAt ?? undefined,
    lastSuccessAt: account.lastSuccessAt ?? undefined,
    lastErrorCode: account.lastErrorCode ?? undefined,
    historyState: account.historyState,
    pollingIntervalMinutes: DEFAULT_GMAIL_POLL_INTERVAL_MINUTES,
    inboxOnly: true,
    readonlyScope: true,
  };
  if (scope) {
    const connected = account.status === 'connected';
    const facts = deriveGmailConnectionFacts({ connected, grantedScopes: scope.grantedScopes });
    dto.canRead = facts.canRead;
    dto.canSend = facts.canSend;
    dto.requiresSendReconsent = facts.requiresSendReconsent;
  }
  return dto;
}
