import 'server-only';
import { randomBytes } from 'node:crypto';
import type { OwnerActor } from '@aicaa/domain';
import type { CreateAuditEventInput, DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { extractEmailDomain, normalizeDomain } from '@/lib/auth/domain-allowlist';
import { DEFAULT_GMAIL_RETURN_PATH, getGmailOAuthConfig } from './config';
import { GmailCallbackError, GmailRequestError, type GmailCallbackErrorCode } from './errors';
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generateStateToken,
  hashOAuthState,
} from './pkce';
import {
  buildGmailAuthUrl,
  exchangeGmailCode,
  revokeGmailToken,
  verifyGmailIdentity,
} from './oauth-client';
import {
  CIPHERTEXT_PURPOSE,
  decryptToken,
  encryptToken,
  getEncryptionKeyMaterial,
} from './token-encryption';
import { buildReturnUrl, resolveSafeReturnPath } from './safe-redirect';
import { mapConnectionToDto, type GmailConnectionDto } from './connection-dto';

/** OAuth state lifetime (D069): short TTL, single use. */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OwnerGmailContext {
  owner: OwnerActor;
  db: DbClient;
  now: string;
  requestId: string;
}

export interface CallbackContext {
  db: DbClient;
  now: string;
  requestId: string;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

function ownerAudit(input: {
  action: string;
  organizationId: string;
  ownerId: string;
  communicationAccountId?: string;
  now: string;
  requestId?: string;
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'owner',
    ownerId: input.ownerId,
    communicationAccountId: input.communicationAccountId,
    action: input.action,
    outcome: 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
  };
}

/**
 * Begin Owner Gmail OAuth (POST). Persists SHA-256 stateHash + encrypted PKCE verifier
 * (never raw state or plaintext verifier) and returns the Google authorization URL.
 * The raw state appears only in the Google redirect URL.
 */
export async function startGmailOAuth(
  ctx: OwnerGmailContext,
  input: { returnPath?: string | null },
): Promise<{ authUrl: string }> {
  const config = getGmailOAuthConfig();
  const runtime = await loadDbRuntime();
  const material = getEncryptionKeyMaterial();

  const rawState = generateStateToken();
  const stateHash = hashOAuthState(rawState);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const encryptedPkceVerifier = encryptToken(
    codeVerifier,
    CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER,
    material,
  );
  const returnPath = resolveSafeReturnPath(input.returnPath, DEFAULT_GMAIL_RETURN_PATH);
  const expiresAt = new Date(new Date(ctx.now).getTime() + STATE_TTL_MS).toISOString();

  await ctx.db.$transaction(async (tx) => {
    await runtime.createGmailOAuthState(tx, {
      id: newId('gost'),
      stateHash,
      organizationId: ctx.owner.organizationId,
      ownerId: ctx.owner.ownerId,
      encryptedPkceVerifier,
      encryptionKeyVersion: material.version,
      redirectPath: returnPath,
      createdAt: ctx.now,
      expiresAt,
    });
    await runtime.createAuditEvent(
      tx,
      ownerAudit({
        action: 'gmail_oauth_started',
        organizationId: ctx.owner.organizationId,
        ownerId: ctx.owner.ownerId,
        now: ctx.now,
        requestId: ctx.requestId,
      }),
    );
  });

  const authUrl = buildGmailAuthUrl({ state: rawState, codeChallenge, config });
  return { authUrl };
}

function assertWorkspaceMailbox(
  email: string,
  hostedDomain: string,
  ownerWorkspaceDomain: string,
): void {
  const allowed = normalizeDomain(ownerWorkspaceDomain);
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain || emailDomain !== allowed) {
    throw new GmailCallbackError('domain_mismatch', 'Mailbox domain does not match workspace.');
  }
  if (normalizeDomain(hostedDomain) !== allowed) {
    throw new GmailCallbackError('domain_mismatch', 'Hosted domain does not match workspace.');
  }
}

function errorRedirect(
  appUrl: string,
  returnPath: string,
  code: GmailCallbackErrorCode,
): { redirectUrl: URL } {
  return {
    redirectUrl: buildReturnUrl(appUrl, returnPath, { key: 'gmail_error', value: code }),
  };
}

async function classifyFailedState(
  runtime: Awaited<ReturnType<typeof loadDbRuntime>>,
  db: DbClient,
  stateHash: string,
  now: string,
  appUrl: string,
  fallbackPath: string,
): Promise<{ redirectUrl: URL }> {
  const inspected = await runtime.inspectGmailOAuthState(db, { stateHash });
  if (!inspected) {
    return errorRedirect(appUrl, fallbackPath, 'invalid_state');
  }
  const returnPath = inspected.redirectPath || fallbackPath;
  if (!inspected.consumedAt && new Date(inspected.expiresAt).getTime() <= new Date(now).getTime()) {
    return errorRedirect(appUrl, returnPath, 'expired_state');
  }
  return errorRedirect(appUrl, returnPath, 'invalid_state');
}

/**
 * Complete Owner Gmail OAuth. Always returns a same-origin redirect URL (success or safe
 * error). Atomically consumes state by hash (wiping encrypted PKCE), exchanges the code,
 * verifies identity, encrypts the refresh token, and persists the connection.
 */
export async function handleGmailCallback(
  ctx: CallbackContext,
  input: { code: string | null; state: string | null; error: string | null },
): Promise<{ redirectUrl: URL }> {
  let config;
  try {
    config = getGmailOAuthConfig();
  } catch {
    return errorRedirect(
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000',
      DEFAULT_GMAIL_RETURN_PATH,
      'configuration_error',
    );
  }

  const runtime = await loadDbRuntime();
  let returnPath = DEFAULT_GMAIL_RETURN_PATH;

  if (input.error) {
    if (input.state) {
      const denied = await runtime.consumeGmailOAuthState(ctx.db, {
        stateHash: hashOAuthState(input.state),
        now: ctx.now,
      });
      if (denied) {
        returnPath = denied.redirectPath;
      }
    }
    return errorRedirect(config.appUrl, returnPath, 'oauth_denied');
  }

  if (!input.state) {
    return errorRedirect(config.appUrl, returnPath, 'invalid_state');
  }

  const stateHash = hashOAuthState(input.state);

  // Atomic single-use consumption first — prevents replay; wipes encrypted verifier.
  const consumed = await runtime.consumeGmailOAuthState(ctx.db, {
    stateHash,
    now: ctx.now,
  });
  if (!consumed || !consumed.encryptedPkceVerifier) {
    return classifyFailedState(runtime, ctx.db, stateHash, ctx.now, config.appUrl, returnPath);
  }
  returnPath = consumed.redirectPath;

  let codeVerifier: string;
  try {
    codeVerifier = decryptToken(
      consumed.encryptedPkceVerifier,
      CIPHERTEXT_PURPOSE.GMAIL_PKCE_VERIFIER,
    );
  } catch {
    return errorRedirect(config.appUrl, returnPath, 'invalid_state');
  }

  if (!input.code) {
    return errorRedirect(config.appUrl, returnPath, 'missing_code');
  }

  let tokens;
  try {
    tokens = await exchangeGmailCode({
      code: input.code,
      codeVerifier,
      config,
    });
  } catch {
    return errorRedirect(config.appUrl, returnPath, 'exchange_failed');
  }

  if (!tokens.idToken) {
    return errorRedirect(config.appUrl, returnPath, 'identity_unverified');
  }

  let identity;
  try {
    identity = await verifyGmailIdentity({ idToken: tokens.idToken, config });
  } catch {
    return errorRedirect(config.appUrl, returnPath, 'identity_unverified');
  }

  try {
    assertWorkspaceMailbox(identity.email, identity.hostedDomain, config.ownerWorkspaceDomain);
  } catch (error) {
    if (error instanceof GmailCallbackError) {
      return errorRedirect(config.appUrl, returnPath, error.code);
    }
    return errorRedirect(config.appUrl, returnPath, 'server_error');
  }

  if (!tokens.refreshToken) {
    return errorRedirect(config.appUrl, returnPath, 'missing_refresh_token');
  }

  let encryptedRefreshToken: string;
  let encryptionKeyVersion: string;
  try {
    const material = getEncryptionKeyMaterial();
    encryptedRefreshToken = encryptToken(
      tokens.refreshToken,
      CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
      material,
    );
    encryptionKeyVersion = material.version;
  } catch {
    return errorRedirect(config.appUrl, returnPath, 'configuration_error');
  }

  const existing = await runtime.getCommunicationAccountByOrganization(
    ctx.db,
    consumed.organizationId,
  );
  const accountId = existing?.id ?? newId('cacct');
  const action = existing ? 'gmail_reconnected' : 'gmail_connected';

  try {
    await runtime.persistGmailConnectionTransaction({
      db: ctx.db,
      organizationId: consumed.organizationId,
      accountId,
      emailAddress: identity.email.trim().toLowerCase(),
      externalAccountId: identity.subject,
      connectedAt: ctx.now,
      credential: {
        id: newId('gcred'),
        encryptedRefreshToken,
        encryptedAccessToken: null,
        accessTokenExpiresAt: null,
        grantedScopes: tokens.grantedScopes,
        tokenType: tokens.tokenType,
        encryptionKeyVersion,
      },
      audit: ownerAudit({
        action,
        organizationId: consumed.organizationId,
        ownerId: consumed.ownerId,
        communicationAccountId: accountId,
        now: ctx.now,
        requestId: ctx.requestId,
      }),
    });
  } catch (error) {
    if (isOrganizationMismatch(error)) {
      return errorRedirect(config.appUrl, returnPath, 'duplicate_account');
    }
    return errorRedirect(config.appUrl, returnPath, 'persistence_failed');
  }

  return {
    redirectUrl: buildReturnUrl(config.appUrl, returnPath, {
      key: 'gmail',
      value: 'connected',
    }),
  };
}

function isOrganizationMismatch(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ORGANIZATION_MISMATCH'
  );
}

/** Read-only Owner Gmail connection status. No mutation and no Gmail API call. */
export async function getGmailConnection(ctx: {
  owner: OwnerActor;
  db: DbClient;
}): Promise<GmailConnectionDto> {
  const runtime = await loadDbRuntime();
  const account = await runtime.getCommunicationAccountByOrganization(
    ctx.db,
    ctx.owner.organizationId,
  );
  if (!account) {
    return mapConnectionToDto(null);
  }
  // Emit contracted canSend / requiresSendReconsent from the persisted grant string (D093).
  // Never expose the raw scope string or credential material in the DTO.
  let grantedScopes: string | null = null;
  try {
    const credential = await runtime.getGmailOAuthCredentialByAccountId(
      ctx.db,
      ctx.owner.organizationId,
      account.id,
    );
    grantedScopes = credential?.grantedScopes ?? null;
  } catch {
    // Missing/invalid credential: treat as no send grant while still returning account status.
    grantedScopes = null;
  }
  return mapConnectionToDto(account, { grantedScopes });
}

/**
 * Disconnect Owner Gmail: best-effort revocation at Google, then wipe credential ciphertext,
 * mark disconnected, clear the sync lock, and record a truthful Owner audit event.
 */
export async function disconnectGmail(
  ctx: OwnerGmailContext,
  input: { confirmation: unknown },
): Promise<GmailConnectionDto> {
  if (input.confirmation !== 'confirmed') {
    throw new GmailRequestError('validation', 'Explicit confirmation is required to disconnect.');
  }

  const runtime = await loadDbRuntime();
  const account = await runtime.getCommunicationAccountByOrganization(
    ctx.db,
    ctx.owner.organizationId,
  );
  if (!account) {
    throw new GmailRequestError('not_found', 'No Gmail account is connected.');
  }
  if (account.status === 'disconnected') {
    return mapConnectionToDto(account);
  }

  try {
    const credential = await runtime.getGmailOAuthCredentialByAccountId(
      ctx.db,
      ctx.owner.organizationId,
      account.id,
    );
    if (credential?.encryptedRefreshToken) {
      const refreshToken = decryptToken(
        credential.encryptedRefreshToken,
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
      );
      await revokeGmailToken({ token: refreshToken });
    }
  } catch {
    // Swallow — revocation and decryption are best-effort; local wipe proceeds.
  }

  const result = await runtime.persistGmailDisconnectTransaction({
    db: ctx.db,
    organizationId: ctx.owner.organizationId,
    accountId: account.id,
    disconnectedAt: ctx.now,
    audit: ownerAudit({
      action: 'gmail_disconnected',
      organizationId: ctx.owner.organizationId,
      ownerId: ctx.owner.ownerId,
      communicationAccountId: account.id,
      now: ctx.now,
      requestId: ctx.requestId,
    }),
  });

  return mapConnectionToDto(result.account);
}
