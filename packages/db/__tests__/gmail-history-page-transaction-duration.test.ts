import { describe, expect, it } from 'vitest';
import type { DbClient } from '../src/client/create-prisma-client.js';
import { persistGmailHistoryPageTransaction } from '../src/transactions/gmail-transactions.js';
import { readPrismaTransactionDurationMs } from '../src/transactions/prisma-transaction-duration.js';

const LEAKY_P2028_NOT_FOUND =
  'Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn\'t have information about anymore. SELECT * FROM "InboxMessage"; postgresql://owner:super_secret@db/app token=ya29.access';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function prismaShapedError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code, clientVersion: '6.19.3' });
  return error;
}

function persistInput(db: Pick<DbClient, '$transaction'>) {
  return {
    db: db as DbClient,
    organizationId: 'org_tx_duration',
    accountId: 'acct_tx_duration',
    historyIdBefore: '1000',
    historyIdAfter: '1100',
    ingestRunId: 'run_tx_duration',
    syncedAt: '2026-08-17T00:00:00.000Z',
    messages: [],
  };
}

describe('persistGmailHistoryPageTransaction duration measurement', () => {
  it('records an integer duration for a delayed interactive $transaction rejection', async () => {
    const error = prismaShapedError('P2028', LEAKY_P2028_NOT_FOUND);
    const originalMessage = error.message;
    const originalStack = error.stack;
    const delayMs = 40;

    await expect(
      persistGmailHistoryPageTransaction(
        persistInput({
          $transaction: async () => {
            await delay(delayMs);
            throw error;
          },
        }),
      ),
    ).rejects.toBe(error);

    const durationMs = readPrismaTransactionDurationMs(error);
    expect(durationMs).toBeDefined();
    expect(Number.isInteger(durationMs)).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(delayMs - 15);
    expect(durationMs).toBeLessThan(400);
    expect((error as { code?: string }).code).toBe('P2028');
    expect(error.name).toBe('PrismaClientKnownRequestError');
    expect(error.message).toBe(originalMessage);
    expect(error.stack).toBe(originalStack);
    expect(Object.keys(error)).not.toContain('prismaTransactionDurationMs');
  });

  it('measures only the $transaction attempt, not work that happened before it', async () => {
    const error = prismaShapedError('P2028', LEAKY_P2028_NOT_FOUND);
    const unrelatedWorkMs = 80;
    await delay(unrelatedWorkMs);

    await expect(
      persistGmailHistoryPageTransaction(
        persistInput({
          $transaction: async () => {
            throw error;
          },
        }),
      ),
    ).rejects.toBe(error);

    const durationMs = readPrismaTransactionDurationMs(error);
    expect(durationMs).toBeDefined();
    expect(Number.isInteger(durationMs)).toBe(true);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(durationMs).toBeLessThan(unrelatedWorkMs);
  });

  it('does not attach a fabricated duration on a successful $transaction', async () => {
    const result = { ok: true };
    const page = await persistGmailHistoryPageTransaction(
      persistInput({
        $transaction: async () => result as never,
      }),
    );
    expect(page).toBe(result);
  });
});
