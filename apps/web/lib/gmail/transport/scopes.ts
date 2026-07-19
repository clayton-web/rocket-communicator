import 'server-only';
import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, type GmailConnectionFacts } from '@aicaa/domain';

/**
 * A7.4 Gmail granted-scope parsing.
 *
 * Google returns granted scopes as a single space-delimited string (OAuth2 `scope`) on the token
 * exchange. We persist that raw string on the credential (`grantedScopes`). Read capability and
 * SEND capability are derived from the STORED grant — never assumed from the mere existence of a
 * connected account. This keeps existing read-only Owners non-send-capable until they re-consent.
 *
 * Caveat (documented limitation): Google does not always re-return the `scope` field on refresh.
 * We therefore treat the last successfully-persisted grant string as authoritative and design
 * conservatively — if the stored grant does not contain gmail.send, the Owner is treated as
 * requiring send re-consent rather than being optimistically assumed send-capable.
 */

export interface ParsedGmailScopes {
  readonly raw: string;
  readonly scopes: ReadonlySet<string>;
  readonly canRead: boolean;
  readonly canSend: boolean;
}

/** Parse a space-delimited OAuth scope grant into a normalized, deduplicated set. */
export function parseGrantedScopes(grantedScopes: string | null | undefined): ParsedGmailScopes {
  const raw = typeof grantedScopes === 'string' ? grantedScopes : '';
  const scopes = new Set(
    raw
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
  );
  return {
    raw,
    scopes,
    canRead: scopes.has(GMAIL_READONLY_SCOPE),
    canSend: scopes.has(GMAIL_SEND_SCOPE),
  };
}

/** True only when the stored grant explicitly includes gmail.send. */
export function hasGmailSendScope(grantedScopes: string | null | undefined): boolean {
  return parseGrantedScopes(grantedScopes).canSend;
}

/**
 * Derive pure domain `GmailConnectionFacts` from the account connection state + stored grant.
 * `requiresSendReconsent` is true whenever the account is connected but the grant lacks send —
 * that is the signal a later Owner UI uses to trigger incremental consent.
 */
export function deriveGmailConnectionFacts(input: {
  connected: boolean;
  grantedScopes: string | null | undefined;
}): GmailConnectionFacts {
  const parsed = parseGrantedScopes(input.grantedScopes);
  const connected = input.connected;
  return {
    connected,
    canRead: connected && parsed.canRead,
    canSend: connected && parsed.canSend,
    requiresSendReconsent: connected && !parsed.canSend,
  };
}
