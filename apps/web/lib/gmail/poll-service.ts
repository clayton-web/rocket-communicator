import 'server-only';
import { randomBytes } from 'node:crypto';
import type { components } from '@aicaa/contracts/schema';
import type { CreateAuditEventInput, DbClient, EligibleGmailAccountForPoll } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { GmailRequestError } from './errors';
import { isGmailSyncError } from './sync-errors';
import {
  runGmailAccountSync,
  type GmailAccountSyncResult,
  type GmailSyncEngineDeps,
} from './sync-engine';

export const MAX_ACCOUNTS_PER_POLL = 3;
export const POLL_MAX_DURATION_MS = 60_000;
export const POLL_STOP_MARGIN_MS = 15_000;
export const GMAIL_POLL_SYSTEM_ID = 'gmail_poll';

export type GmailPollResponse = components['schemas']['GmailPollResponse'];

type ListEligibleFn = (
  db: DbClient,
  options?: { limit?: number },
) => Promise<EligibleGmailAccountForPoll[]>;
type RunAccountSyncFn = typeof runGmailAccountSync;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

function systemInvocationAudit(input: {
  organizationId: string;
  now: string;
  requestId: string;
  note?: string;
}): CreateAuditEventInput {
  return {
    id: newId('audit'),
    organizationId: input.organizationId,
    actorKind: 'system',
    systemId: GMAIL_POLL_SYSTEM_ID,
    action: 'gmail_poll_invocation',
    outcome: 'succeeded',
    requestId: input.requestId,
    recordedAt: input.now,
    note: input.note,
  };
}

/**
 * Internal cron Gmail poll (A5.5). Discovers eligible accounts and runs incremental sync
 * sequentially with a soft deadline. Never performs initial cursor seeding.
 */
export async function runInternalGmailPoll(input: {
  db: DbClient;
  requestId: string;
  now?: string;
  startedAtMs?: number;
  deadlineMs?: number;
  maxAccounts?: number;
  deps?: GmailSyncEngineDeps;
  listEligible?: ListEligibleFn;
  runAccountSync?: RunAccountSyncFn;
}): Promise<{ response: GmailPollResponse }> {
  const runtime = await loadDbRuntime();
  const now = input.now ?? new Date().toISOString();
  const startedAtMs = input.startedAtMs ?? Date.now();
  const deadlineMs = input.deadlineMs ?? startedAtMs + POLL_MAX_DURATION_MS;
  const maxAccounts = input.maxAccounts ?? MAX_ACCOUNTS_PER_POLL;
  const listEligible = input.listEligible ?? runtime.listEligibleGmailAccountsForPoll;
  const runAccountSync = input.runAccountSync ?? runGmailAccountSync;

  const eligible = await listEligible(input.db, { limit: maxAccounts });

  let runsProcessed = 0;
  let skippedLocked = 0;

  for (const account of eligible) {
    if (Date.now() > deadlineMs - POLL_STOP_MARGIN_MS) {
      break;
    }

    let result: GmailAccountSyncResult;
    try {
      result = await runAccountSync(
        {
          db: input.db,
          organizationId: account.organizationId,
          accountId: account.id,
          trigger: 'cron',
          actor: { kind: 'system', systemId: GMAIL_POLL_SYSTEM_ID },
          now,
          requestId: input.requestId,
          allowInitial: false,
        },
        input.deps,
      );
    } catch (error) {
      if (isGmailSyncError(error) && error.code === 'configuration_error') {
        throw error;
      }
      if (isGmailSyncError(error) && error.code === 'rate_limited') {
        break;
      }
      if (error instanceof GmailRequestError) {
        // Per-account refuse (e.g. initial required) — continue other accounts.
        continue;
      }
      // Unexpected but non-fatal for remaining accounts.
      continue;
    }

    if (result.status === 'skipped_locked') {
      skippedLocked += 1;
      continue;
    }

    runsProcessed += 1;

    if (result.run.errorCode === 'rate_limited') {
      break;
    }
  }

  // Prefer an org we actually touched; otherwise the configured Owner org id (no fake "system" org).
  const auditOrgId =
    eligible[0]?.organizationId ??
    (typeof process.env.OWNER_ORGANIZATION_ID === 'string' &&
    process.env.OWNER_ORGANIZATION_ID.length > 0
      ? process.env.OWNER_ORGANIZATION_ID
      : null);
  if (auditOrgId) {
    await runtime.createAuditEvent(
      input.db,
      systemInvocationAudit({
        organizationId: auditOrgId,
        now,
        requestId: input.requestId,
      }),
    );
  }

  return {
    response: {
      runsProcessed,
      skippedLocked,
      requestId: input.requestId,
    },
  };
}
