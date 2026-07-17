import 'server-only';
import { randomBytes } from 'node:crypto';
import {
  asCommunicationEventId,
  asTemporaryCommunicationExcerptId,
  computeDefaultGmailExcerptPurgeAt,
  isGmailInboxEligible,
  MAX_GMAIL_HISTORY_PAGES_PER_RUN,
  MAX_GMAIL_MESSAGES_PER_RUN,
  type CommunicationAccount,
  type GmailSyncOutcome,
  type GmailSyncRun,
  type GmailSyncTrigger,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import type { CreateAuditEventInput, DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { GmailConfigError } from './config';
import { GmailRequestError } from './errors';
import {
  defaultGmailApiClient,
  extractMessageIdsFromHistory,
  type GmailApiClient,
  type GmailHistoryListResponse,
} from './gmail-api-client';
import { getGmailAccessToken, type GmailAccessTokenProvider } from './access-token';
import { normalizeGmailMessage } from './normalize';
import { mapConnectionToDto, type GmailConnectionDto } from './connection-dto';
import { CIPHERTEXT_PURPOSE, decryptToken } from './token-encryption';
import { isGmailSyncError, GmailSyncError } from './sync-errors';
import type { OwnerGmailContext } from './service';

/** Sync lock TTL — long enough for a bounded multi-page run. */
export const SYNC_LOCK_TTL_MS = 5 * 60 * 1000;

/** Soft cap on history pages processed in one Owner request. */
export const MAX_HISTORY_PAGES_PER_RUN = MAX_GMAIL_HISTORY_PAGES_PER_RUN;

/** Soft cap on messages fetched in one Owner request. */
export const MAX_MESSAGES_PER_RUN = MAX_GMAIL_MESSAGES_PER_RUN;

export interface GmailSyncEngineDeps {
  gmailClient?: GmailApiClient;
  getAccessToken?: GmailAccessTokenProvider;
}

export type GmailSyncActorRef =
  { kind: 'owner'; ownerId: string } | { kind: 'system'; systemId: string };

export interface GmailAccountSyncContext {
  db: DbClient;
  organizationId: string;
  accountId: string;
  /** Caller-supplied trigger. Owner wrapper computes initial|manual. Cron always passes 'cron'. */
  trigger: GmailSyncTrigger;
  actor: GmailSyncActorRef;
  now: string;
  requestId: string;
  /**
   * Cron must never initial-seed. When false and account needs initial, refuse without calling Gmail.
   * Cron path sets allowInitial=false. Owner path sets allowInitial=true.
   */
  allowInitial: boolean;
}

export type GmailAccountSyncResult =
  | { status: 'completed'; run: GmailSyncRun; connection: GmailConnectionDto }
  | { status: 'skipped_locked'; connection: GmailConnectionDto | null };

export interface OwnerGmailSyncResult {
  run: GmailSyncRun;
  connection: GmailConnectionDto;
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
  outcome?: 'succeeded' | 'failed';
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'owner',
    ownerId: input.ownerId,
    communicationAccountId: input.communicationAccountId,
    action: input.action,
    outcome: input.outcome ?? 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
  };
}

function systemAudit(input: {
  action: string;
  organizationId: string;
  systemId: string;
  communicationAccountId?: string;
  now: string;
  requestId?: string;
  outcome?: 'succeeded' | 'failed';
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'system',
    systemId: input.systemId,
    communicationAccountId: input.communicationAccountId,
    action: input.action,
    outcome: input.outcome ?? 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
  };
}

function toParsedFixture(
  normalized: ReturnType<typeof normalizeGmailMessage>,
  syncedAt: string,
): ParsedGmailMessageFixture {
  const eventId = asCommunicationEventId(newId('cevt'));
  const fixture: ParsedGmailMessageFixture = {
    eventId,
    providerMessageId: normalized.providerMessageId,
    providerThreadId: normalized.providerThreadId,
    internalDate: normalized.internalDate,
    receivedAt: normalized.receivedAt ?? normalized.internalDate,
    fromAddress: normalized.fromAddress,
    toAddresses: normalized.toAddresses,
    subject: normalized.subject,
    snippet: normalized.snippet,
    labelIds: normalized.labelIds,
    hasAttachments: normalized.hasAttachments,
    attachmentMetadata: normalized.attachmentMetadata,
  };

  if (
    isGmailInboxEligible(normalized.labelIds) &&
    normalized.excerptContent &&
    normalized.excerptContent.length > 0
  ) {
    fixture.excerptId = asTemporaryCommunicationExcerptId(newId('tcex'));
    fixture.excerptContent = normalized.excerptContent;
    fixture.excerptPurgeAt = computeDefaultGmailExcerptPurgeAt(syncedAt);
  }

  return fixture;
}

/**
 * Choose historyIdAfter for a committed page.
 * When more pages remain, advance only through the max record id on this page so later
 * pages are not skipped if the run stops early. On the final page, use mailbox historyId.
 */
export function resolveHistoryIdAfter(
  page: GmailHistoryListResponse,
  hasMorePages: boolean,
  fallback: string,
): string {
  if (!hasMorePages) {
    return String(page.historyId ?? fallback);
  }
  let maxId: bigint | null = null;
  for (const record of page.history ?? []) {
    if (record.id == null || record.id === '') {
      continue;
    }
    try {
      const value = BigInt(String(record.id));
      if (maxId == null || value > maxId) {
        maxId = value;
      }
    } catch {
      // Non-numeric ids: keep as string fallback via lexicographic max below.
    }
  }
  if (maxId != null) {
    return maxId.toString();
  }
  return String(page.historyId ?? fallback);
}

function needsInitialCursor(account: CommunicationAccount): boolean {
  return account.historyState === 'unset' || account.historyId == null;
}

/**
 * Shared Gmail History sync for Owner manual/initial and system cron (A5.4 / A5.5).
 * Lock conflicts never throw — callers receive skipped_locked.
 */
export async function runGmailAccountSync(
  ctx: GmailAccountSyncContext,
  deps: GmailSyncEngineDeps = {},
): Promise<GmailAccountSyncResult> {
  const runtime = await loadDbRuntime();
  const gmailClient = deps.gmailClient ?? defaultGmailApiClient;
  const tokenProvider = deps.getAccessToken ?? getGmailAccessToken;
  const orgId = ctx.organizationId;

  let account: CommunicationAccount;
  try {
    account = await runtime.getCommunicationAccountById(ctx.db, orgId, ctx.accountId);
  } catch {
    throw new GmailRequestError('not_found', 'No Gmail account is connected.');
  }
  if (account.status === 'disconnected') {
    throw new GmailRequestError('not_found', 'No Gmail account is connected.');
  }

  if (!ctx.allowInitial && needsInitialCursor(account)) {
    throw new GmailRequestError('conflict', 'Gmail account requires initial sync before polling.');
  }

  const runId = newId('gsrun');
  const isInitial = needsInitialCursor(account);

  if (account.status === 'needs_reauth') {
    return {
      status: 'completed',
      ...(await finishEarly(ctx, runtime, account, runId, 'needs_reauth', 'needs_reauth')),
    };
  }
  if (account.status === 'resync_required' || account.historyState === 'resync_required') {
    return {
      status: 'completed',
      ...(await finishEarly(ctx, runtime, account, runId, 'resync_required', 'resync_required')),
    };
  }
  if (account.status !== 'connected') {
    throw new GmailRequestError('conflict', 'Gmail account is not ready to synchronize.');
  }

  const lockUntil = new Date(new Date(ctx.now).getTime() + SYNC_LOCK_TTL_MS).toISOString();
  const lock = await runtime.acquireGmailSyncLock(
    ctx.db,
    orgId,
    account.id,
    lockUntil,
    ctx.now,
    runId,
  );
  if (!lock.acquired) {
    return {
      status: 'skipped_locked',
      connection: lock.account ? mapConnectionToDto(lock.account) : null,
    };
  }

  let completed: OwnerGmailSyncResult | undefined;
  let runCreated = false;

  try {
    const run = await runtime.createGmailSyncRun(ctx.db, {
      id: runId,
      organizationId: orgId,
      accountId: account.id,
      trigger: ctx.trigger,
      startedAt: ctx.now,
      historyIdBefore: account.historyId,
      requestId: ctx.requestId,
    });
    runCreated = true;
    void run;

    if (ctx.actor.kind === 'owner') {
      await runtime.createAuditEvent(
        ctx.db,
        ownerAudit({
          action: 'gmail_manual_sync_started',
          organizationId: orgId,
          ownerId: ctx.actor.ownerId,
          communicationAccountId: account.id,
          now: ctx.now,
          requestId: ctx.requestId,
        }),
      );
    }

    let accessToken: string | undefined;
    try {
      const credential = await runtime.getGmailOAuthCredentialByAccountId(
        ctx.db,
        orgId,
        account.id,
      );
      if (!credential?.encryptedRefreshToken) {
        throw new GmailSyncError('needs_reauth', 'Gmail credential is missing.');
      }
      const refreshToken = decryptToken(
        credential.encryptedRefreshToken,
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
      );
      accessToken = await tokenProvider({ refreshToken });
    } catch (error) {
      const syncError = toSyncError(error);
      if (syncError.code === 'needs_reauth') {
        const marked = await runtime.markCommunicationAccountNeedsReauth(
          ctx.db,
          orgId,
          account.id,
          syncError.code,
          ctx.now,
        );
        const finished = await runtime.finishGmailSyncRun(ctx.db, {
          organizationId: orgId,
          runId,
          outcome: 'needs_reauth',
          finishedAt: ctx.now,
          retryable: false,
          errorCode: syncError.code,
        });
        if (ctx.actor.kind === 'owner') {
          await runtime.createAuditEvent(
            ctx.db,
            ownerAudit({
              action: 'gmail_manual_sync_failed',
              organizationId: orgId,
              ownerId: ctx.actor.ownerId,
              communicationAccountId: account.id,
              now: ctx.now,
              requestId: ctx.requestId,
              outcome: 'failed',
            }),
          );
        } else {
          await runtime.createAuditEvent(
            ctx.db,
            systemAudit({
              action: 'gmail_needs_reauth',
              organizationId: orgId,
              systemId: ctx.actor.systemId,
              communicationAccountId: account.id,
              now: ctx.now,
              requestId: ctx.requestId,
              outcome: 'failed',
            }),
          );
        }
        completed = { run: finished, connection: mapConnectionToDto(marked) };
      } else {
        const finished = await finishFailure(runtime, ctx, runId, account.id, syncError);
        const latest =
          (await runtime.getCommunicationAccountByOrganization(ctx.db, orgId)) ?? account;
        completed = { run: finished, connection: mapConnectionToDto(latest) };
      }
    }

    if (!completed && accessToken) {
      if (isInitial) {
        completed = await runInitialCursor(ctx, runtime, gmailClient, accessToken, account, runId);
      } else {
        completed = await runIncrementalHistory(
          ctx,
          runtime,
          gmailClient,
          accessToken,
          account,
          runId,
        );
      }
    }
  } catch (error) {
    if (error instanceof GmailRequestError) {
      throw error;
    }

    const syncError = toSyncError(error);
    if (syncError.code === 'invalid_history' && runCreated) {
      const marked = await runtime.markCommunicationAccountResyncRequired(
        ctx.db,
        orgId,
        account.id,
        syncError.code,
        ctx.now,
      );
      const finished = await runtime.finishGmailSyncRun(ctx.db, {
        organizationId: orgId,
        runId,
        outcome: 'resync_required',
        finishedAt: ctx.now,
        retryable: false,
        errorCode: syncError.code,
        historyIdAfter: account.historyId,
      });
      if (ctx.actor.kind === 'owner') {
        await runtime.createAuditEvent(
          ctx.db,
          ownerAudit({
            action: 'gmail_resync_required',
            organizationId: orgId,
            ownerId: ctx.actor.ownerId,
            communicationAccountId: account.id,
            now: ctx.now,
            requestId: ctx.requestId,
            outcome: 'failed',
          }),
        );
      } else {
        await runtime.createAuditEvent(
          ctx.db,
          systemAudit({
            action: 'gmail_resync_required',
            organizationId: orgId,
            systemId: ctx.actor.systemId,
            communicationAccountId: account.id,
            now: ctx.now,
            requestId: ctx.requestId,
            outcome: 'failed',
          }),
        );
      }
      completed = { run: finished, connection: mapConnectionToDto(marked) };
    } else if (runCreated) {
      const finished = await finishFailure(runtime, ctx, runId, account.id, syncError);
      const latest =
        (await runtime.getCommunicationAccountByOrganization(ctx.db, orgId)) ?? account;
      completed = { run: finished, connection: mapConnectionToDto(latest) };
    } else {
      throw syncError;
    }
  } finally {
    try {
      const released = await runtime.releaseGmailSyncLock(
        ctx.db,
        orgId,
        account.id,
        runId,
        new Date().toISOString(),
      );
      if (completed) {
        completed.connection = mapConnectionToDto(released.account);
      }
    } catch {
      // Lock release is best-effort; expiry reclaim covers stale locks.
    }
  }

  if (!completed) {
    throw new GmailSyncError('unknown');
  }
  return { status: 'completed', run: completed.run, connection: completed.connection };
}

/**
 * Owner-triggered Gmail History sync (A5.4). Thin wrapper over runGmailAccountSync.
 * Lock conflicts throw GmailSyncError('lock_conflict') for HTTP 409 mapping.
 */
export async function runOwnerGmailSync(
  ctx: OwnerGmailContext,
  deps: GmailSyncEngineDeps = {},
): Promise<OwnerGmailSyncResult> {
  const runtime = await loadDbRuntime();
  const orgId = ctx.owner.organizationId;

  const account = await runtime.getCommunicationAccountByOrganization(ctx.db, orgId);
  if (!account || account.status === 'disconnected') {
    throw new GmailRequestError('not_found', 'No Gmail account is connected.');
  }

  const isInitial = needsInitialCursor(account);
  const trigger: GmailSyncTrigger = isInitial ? 'initial' : 'manual';

  const result = await runGmailAccountSync(
    {
      db: ctx.db,
      organizationId: orgId,
      accountId: account.id,
      trigger,
      actor: { kind: 'owner', ownerId: ctx.owner.ownerId },
      now: ctx.now,
      requestId: ctx.requestId,
      allowInitial: true,
    },
    deps,
  );

  if (result.status === 'skipped_locked') {
    throw new GmailSyncError('lock_conflict');
  }
  return { run: result.run, connection: result.connection };
}

type DbRuntime = Awaited<ReturnType<typeof loadDbRuntime>>;

async function finishEarly(
  ctx: GmailAccountSyncContext,
  runtime: DbRuntime,
  account: CommunicationAccount,
  runId: string,
  outcome: GmailSyncOutcome,
  errorCode: string,
): Promise<OwnerGmailSyncResult> {
  await runtime.createGmailSyncRun(ctx.db, {
    id: runId,
    organizationId: ctx.organizationId,
    accountId: account.id,
    trigger: ctx.trigger,
    startedAt: ctx.now,
    historyIdBefore: account.historyId,
    requestId: ctx.requestId,
  });
  const run = await runtime.finishGmailSyncRun(ctx.db, {
    organizationId: ctx.organizationId,
    runId,
    outcome,
    finishedAt: ctx.now,
    retryable: false,
    errorCode,
    historyIdAfter: account.historyId,
  });

  if (ctx.actor.kind === 'system') {
    if (outcome === 'needs_reauth') {
      await runtime.createAuditEvent(
        ctx.db,
        systemAudit({
          action: 'gmail_needs_reauth',
          organizationId: ctx.organizationId,
          systemId: ctx.actor.systemId,
          communicationAccountId: account.id,
          now: ctx.now,
          requestId: ctx.requestId,
          outcome: 'failed',
        }),
      );
    } else if (outcome === 'resync_required') {
      await runtime.createAuditEvent(
        ctx.db,
        systemAudit({
          action: 'gmail_resync_required',
          organizationId: ctx.organizationId,
          systemId: ctx.actor.systemId,
          communicationAccountId: account.id,
          now: ctx.now,
          requestId: ctx.requestId,
          outcome: 'failed',
        }),
      );
    }
  }

  return { run, connection: mapConnectionToDto(account) };
}

async function runInitialCursor(
  ctx: GmailAccountSyncContext,
  runtime: DbRuntime,
  gmailClient: GmailApiClient,
  accessToken: string,
  account: CommunicationAccount,
  runId: string,
): Promise<OwnerGmailSyncResult> {
  const profile = await gmailClient.getProfile(accessToken);
  const historyIdAfter = String(profile.historyId);

  const page = await runtime.persistGmailHistoryPageTransaction({
    db: ctx.db,
    organizationId: ctx.organizationId,
    accountId: account.id,
    historyIdBefore: null,
    historyIdAfter,
    ingestRunId: runId,
    syncedAt: ctx.now,
    messages: [],
  });

  const run = await runtime.finishGmailSyncRun(ctx.db, {
    organizationId: ctx.organizationId,
    runId,
    outcome: 'succeeded',
    finishedAt: ctx.now,
    historyIdAfter,
    messagesExamined: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    messagesSkipped: 0,
    retryable: false,
    errorCode: null,
  });

  if (ctx.actor.kind === 'owner') {
    await runtime.createAuditEvent(
      ctx.db,
      ownerAudit({
        action: 'gmail_manual_sync_succeeded',
        organizationId: ctx.organizationId,
        ownerId: ctx.actor.ownerId,
        communicationAccountId: account.id,
        now: ctx.now,
        requestId: ctx.requestId,
      }),
    );
  }

  return { run, connection: mapConnectionToDto(page.account) };
}

async function runIncrementalHistory(
  ctx: GmailAccountSyncContext,
  runtime: DbRuntime,
  gmailClient: GmailApiClient,
  accessToken: string,
  account: CommunicationAccount,
  runId: string,
): Promise<OwnerGmailSyncResult> {
  const startHistoryId = String(account.historyId);
  let currentHistoryId = startHistoryId;
  let pageToken: string | undefined;
  let pagesProcessed = 0;
  let messagesExamined = 0;
  let eventsCreated = 0;
  let eventsUpdated = 0;
  let messagesSkipped = 0;
  let latestAccount = account;
  let stoppedEarly = false;
  const fetchedMessageIds = new Set<string>();

  while (pagesProcessed < MAX_HISTORY_PAGES_PER_RUN) {
    const remainingMessages = MAX_MESSAGES_PER_RUN - messagesExamined;
    if (remainingMessages <= 0) {
      stoppedEarly = true;
      break;
    }

    const historyPage = await gmailClient.listHistory({
      accessToken,
      startHistoryId,
      pageToken,
    });

    const messageIds = extractMessageIdsFromHistory(historyPage.history).filter(
      (messageId) => !fetchedMessageIds.has(messageId),
    );
    // All-or-nothing per page: do not advance past unfetched messages on this page.
    if (messageIds.length > remainingMessages) {
      stoppedEarly = true;
      break;
    }

    const fixtures: ParsedGmailMessageFixture[] = [];
    for (const messageId of messageIds) {
      const raw = await gmailClient.getMessage({ accessToken, messageId });
      fetchedMessageIds.add(messageId);
      messagesExamined += 1;
      try {
        const normalized = normalizeGmailMessage(raw);
        fixtures.push(toParsedFixture(normalized, ctx.now));
      } catch (error) {
        if (isGmailSyncError(error) && error.code === 'malformed_message') {
          messagesSkipped += 1;
          continue;
        }
        throw error;
      }
    }

    const hasMorePages = Boolean(historyPage.nextPageToken);
    const historyIdAfter = resolveHistoryIdAfter(historyPage, hasMorePages, currentHistoryId);

    const persisted = await runtime.persistGmailHistoryPageTransaction({
      db: ctx.db,
      organizationId: ctx.organizationId,
      accountId: account.id,
      historyIdBefore: currentHistoryId,
      historyIdAfter,
      ingestRunId: runId,
      syncedAt: ctx.now,
      messages: fixtures,
    });

    eventsCreated += persisted.eventsCreated;
    eventsUpdated += persisted.eventsUpdated;
    messagesSkipped += persisted.messagesSkipped;
    latestAccount = persisted.account;
    currentHistoryId = historyIdAfter;
    pagesProcessed += 1;

    if (!hasMorePages) {
      stoppedEarly = false;
      break;
    }
    pageToken = historyPage.nextPageToken;
    if (pagesProcessed >= MAX_HISTORY_PAGES_PER_RUN) {
      stoppedEarly = true;
      break;
    }
  }

  const outcome: GmailSyncOutcome = stoppedEarly ? 'partial' : 'succeeded';
  const run = await runtime.finishGmailSyncRun(ctx.db, {
    organizationId: ctx.organizationId,
    runId,
    outcome,
    finishedAt: ctx.now,
    historyIdAfter: currentHistoryId,
    messagesExamined,
    eventsCreated,
    eventsUpdated,
    messagesSkipped,
    retryable: stoppedEarly,
    errorCode: null,
  });

  if (ctx.actor.kind === 'owner') {
    await runtime.createAuditEvent(
      ctx.db,
      ownerAudit({
        action: 'gmail_manual_sync_succeeded',
        organizationId: ctx.organizationId,
        ownerId: ctx.actor.ownerId,
        communicationAccountId: account.id,
        now: ctx.now,
        requestId: ctx.requestId,
      }),
    );
  }

  return { run, connection: mapConnectionToDto(latestAccount) };
}

async function finishFailure(
  runtime: DbRuntime,
  ctx: GmailAccountSyncContext,
  runId: string,
  accountId: string,
  syncError: GmailSyncError,
): Promise<GmailSyncRun> {
  const outcome: GmailSyncOutcome = syncError.retryable ? 'retryable_failure' : 'permanent_failure';
  const run = await runtime.finishGmailSyncRun(ctx.db, {
    organizationId: ctx.organizationId,
    runId,
    outcome,
    finishedAt: ctx.now,
    retryable: syncError.retryable,
    errorCode: syncError.code,
  });
  if (ctx.actor.kind === 'owner') {
    await runtime.createAuditEvent(
      ctx.db,
      ownerAudit({
        action: 'gmail_manual_sync_failed',
        organizationId: ctx.organizationId,
        ownerId: ctx.actor.ownerId,
        communicationAccountId: accountId,
        now: ctx.now,
        requestId: ctx.requestId,
        outcome: 'failed',
      }),
    );
  }
  return run;
}

function toSyncError(error: unknown): GmailSyncError {
  if (error instanceof GmailSyncError) {
    return error;
  }
  if (error instanceof GmailConfigError) {
    return new GmailSyncError('configuration_error');
  }
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: string }).name === 'TokenEncryptionError'
  ) {
    return new GmailSyncError('configuration_error', 'Gmail credential decryption failed.');
  }
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (
      code === 'VALIDATION' ||
      code === 'NOT_FOUND' ||
      code === 'ORGANIZATION_MISMATCH' ||
      code === 'UNIQUE_VIOLATION' ||
      code === 'OPTIMISTIC_CONCURRENCY' ||
      code === 'TRANSACTION_FAILED'
    ) {
      return new GmailSyncError('database_failure');
    }
  }
  return new GmailSyncError('unknown');
}
