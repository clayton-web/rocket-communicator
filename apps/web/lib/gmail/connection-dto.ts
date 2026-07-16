import 'server-only';
import { DEFAULT_GMAIL_POLL_INTERVAL_MINUTES, type CommunicationAccount } from '@aicaa/domain';
import type { components } from '@aicaa/contracts/schema';

export type GmailConnectionDto = components['schemas']['GmailConnection'];

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
  };
}

export function mapConnectionToDto(account: CommunicationAccount | null): GmailConnectionDto {
  if (!account) {
    return notConnectedDto();
  }
  return {
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
}
