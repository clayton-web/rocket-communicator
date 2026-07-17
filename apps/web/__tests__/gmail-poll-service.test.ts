// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asOrganizationId, GMAIL_READONLY_SCOPE } from '@aicaa/domain';
import { persistGmailConnectionTransaction, type DbClient } from '@aicaa/db';
import { createTestDatabase, type TestDatabase } from '@aicaa/db/testing';
import { clearDbTestRuntime, installDbTestRuntime } from './helpers/db-test-runtime';
import { CIPHERTEXT_PURPOSE, encryptToken } from '@/lib/gmail/token-encryption';
import { runInternalGmailPoll, GMAIL_POLL_SYSTEM_ID } from '@/lib/gmail/poll-service';
import type { GmailAccountSyncResult } from '@/lib/gmail/sync-engine';
import { GmailSyncError } from '@/lib/gmail/sync-errors';

const org = 'org_poll_svc';
const now = '2026-07-16T22:00:00.000Z';
const accountId = 'cacct_poll_svc';
const credentialId = 'gcred_poll_svc';

const material = {
  key: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
  version: '1',
};

let db: TestDatabase;

async function seedConnectedValidAccount() {
  await persistGmailConnectionTransaction({
    db: db.prisma,
    organizationId: org,
    accountId,
    emailAddress: 'owner@example.com',
    externalAccountId: 'google-sub-poll',
    connectedAt: now,
    credential: {
      id: credentialId,
      encryptedRefreshToken: encryptToken(
        'rt_poll',
        CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN,
        material,
      ),
      grantedScopes: GMAIL_READONLY_SCOPE,
      encryptionKeyVersion: '1',
    },
    audit: {
      id: `audit_connect_poll_${Date.now()}`,
      organizationId: org,
      actorKind: 'owner',
      ownerId: 'owner_poll',
      action: 'gmail_connected',
      outcome: 'succeeded',
      recordedAt: now,
    },
  });
  await db.prisma.communicationAccount.update({
    where: { id: accountId },
    data: { historyId: '1000', historyState: 'valid', lastSuccessAt: new Date(now) },
  });
}

function completedRun(outcome: string, errorCode: string | null = null): GmailAccountSyncResult {
  return {
    status: 'completed',
    run: {
      id: 'gsrun_test' as never,
      organizationId: asOrganizationId(org),
      accountId: accountId as never,
      trigger: 'cron',
      outcome: outcome as never,
      startedAt: now,
      finishedAt: now,
      historyIdBefore: '1000',
      historyIdAfter: '1000',
      messagesExamined: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      messagesSkipped: 0,
      retryable: Boolean(errorCode),
      errorCode,
      requestId: 'req_poll',
    },
    connection: {
      status: 'connected',
      provider: 'gmail',
      historyState: 'valid',
      pollingIntervalMinutes: 5,
      inboxOnly: true,
      readonlyScope: true,
    },
  };
}

describe('A5.5 poll orchestration', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    clearDbTestRuntime();
    await db.close();
  });

  beforeEach(async () => {
    installDbTestRuntime(db.prisma);
    await seedConnectedValidAccount();
  });

  it('returns zeros when no eligible accounts', async () => {
    await db.prisma.communicationAccount.update({
      where: { id: accountId },
      data: { historyState: 'unset', historyId: null },
    });
    const runAccountSync = vi.fn();
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_empty',
      now,
      runAccountSync,
    });
    expect(result.response).toEqual({
      runsProcessed: 0,
      skippedLocked: 0,
      requestId: 'req_empty',
    });
    expect(runAccountSync).not.toHaveBeenCalled();
  });

  it('processes one account with cron trigger and system actor', async () => {
    const runAccountSync = vi.fn(async () => completedRun('succeeded'));
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_one',
      now,
      runAccountSync,
    });
    expect(result.response.runsProcessed).toBe(1);
    expect(result.response.skippedLocked).toBe(0);
    expect(runAccountSync).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org,
        accountId,
        trigger: 'cron',
        allowInitial: false,
        actor: { kind: 'system', systemId: GMAIL_POLL_SYSTEM_ID },
      }),
      undefined,
    );
    const audits = await db.prisma.auditEvent.findMany({
      where: { action: 'gmail_poll_invocation', requestId: 'req_one' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorKind).toBe('system');
    expect(audits[0]?.systemId).toBe(GMAIL_POLL_SYSTEM_ID);
  });

  it('counts skipped_locked and continues', async () => {
    const runAccountSync = vi.fn(async () => ({
      status: 'skipped_locked' as const,
      connection: null,
    }));
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_lock',
      now,
      runAccountSync,
    });
    expect(result.response).toEqual({
      runsProcessed: 0,
      skippedLocked: 1,
      requestId: 'req_lock',
    });
  });

  it('stops remaining accounts after rate_limited', async () => {
    const calls: string[] = [];
    const runAccountSync = vi.fn(async (ctx) => {
      calls.push(ctx.accountId);
      return completedRun('retryable_failure', 'rate_limited');
    });
    const listEligible = vi.fn(async () => [
      { id: 'a1', organizationId: org },
      { id: 'a2', organizationId: org },
    ]);
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_429',
      now,
      listEligible,
      runAccountSync,
    });
    expect(result.response.runsProcessed).toBe(1);
    expect(calls).toEqual(['a1']);
  });

  it('does not start new accounts when wall-clock margin is exhausted', async () => {
    const runAccountSync = vi.fn(async () => completedRun('succeeded'));
    const listEligible = vi.fn(async () => [
      { id: 'a1', organizationId: org },
      { id: 'a2', organizationId: org },
    ]);
    const startedAtMs = Date.now();
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_deadline',
      now,
      startedAtMs,
      deadlineMs: startedAtMs + 10_000, // margin 15s ⇒ stop immediately
      listEligible,
      runAccountSync,
    });
    expect(runAccountSync).not.toHaveBeenCalled();
    expect(result.response.runsProcessed).toBe(0);
  });

  it('continues after isolated non-rate-limit failures', async () => {
    const runAccountSync = vi
      .fn()
      .mockResolvedValueOnce(completedRun('retryable_failure', 'google_unavailable'))
      .mockResolvedValueOnce(completedRun('succeeded'));
    const listEligible = vi.fn(async () => [
      { id: 'a1', organizationId: org },
      { id: 'a2', organizationId: org },
    ]);
    const result = await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_5xx',
      now,
      listEligible,
      runAccountSync,
    });
    expect(result.response.runsProcessed).toBe(2);
    expect(runAccountSync).toHaveBeenCalledTimes(2);
  });

  it('rethrows configuration_error', async () => {
    const runAccountSync = vi.fn(async () => {
      throw new GmailSyncError('configuration_error');
    });
    await expect(
      runInternalGmailPoll({
        db: db.prisma as DbClient,
        requestId: 'req_cfg',
        now,
        runAccountSync,
      }),
    ).rejects.toMatchObject({ code: 'configuration_error' });
  });

  it('limits discovery to three accounts', async () => {
    const listEligible = vi.fn(async (_db, options) => {
      expect(options?.limit).toBe(3);
      return [];
    });
    await runInternalGmailPoll({
      db: db.prisma as DbClient,
      requestId: 'req_limit',
      now,
      listEligible,
      runAccountSync: vi.fn(),
    });
    expect(listEligible).toHaveBeenCalled();
  });
});
