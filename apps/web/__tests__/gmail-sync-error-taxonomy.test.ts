// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyGmailPersistenceFailure, GmailSyncError } from '@/lib/gmail/sync-errors';

function persistenceError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'PersistenceError';
  Object.assign(error, { code });
  return error;
}

function prismaKnownRequestError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code });
  return error;
}

describe('Gmail persistence diagnostic taxonomy', () => {
  it('maps cursor/state validation and optimistic-concurrency to persistence_validation', () => {
    for (const code of ['VALIDATION', 'OPTIMISTIC_CONCURRENCY'] as const) {
      const classified = classifyGmailPersistenceFailure(
        persistenceError(
          code,
          'historyIdBefore does not match persisted cursor; refusing silent advance (D075/D076). SELECT history_id FROM communication_accounts',
        ),
      );
      expect(classified).toBeInstanceOf(GmailSyncError);
      expect(classified?.code).toBe('persistence_validation');
      expect(classified?.retryable).toBe(true);
      expect(classified?.message).toBe('Gmail sync persistence was refused.');
      expect(classified?.message).not.toMatch(/historyIdBefore|SELECT|D075|D076/i);
    }
  });

  it('maps TRANSACTION_FAILED to transaction_failure', () => {
    const classified = classifyGmailPersistenceFailure(
      persistenceError(
        'TRANSACTION_FAILED',
        'interactive transaction failed: postgres://user:secret@db/app timeout',
      ),
    );
    expect(classified?.code).toBe('transaction_failure');
    expect(classified?.retryable).toBe(true);
    expect(classified?.message).toBe('Gmail sync transaction failed.');
    expect(classified?.message).not.toMatch(/postgres:\/\/|secret|timeout|interactive/i);
  });

  it('maps Prisma known-request codes to database_failure without persisting the P-code', () => {
    for (const code of ['P2028', 'P2022', 'P1001', 'P2034'] as const) {
      const classified = classifyGmailPersistenceFailure(
        prismaKnownRequestError(
          code,
          `Transaction API error ${code}: A commit cannot be executed on an expired transaction. Connection string: postgres://owner:ya29_token@db/app`,
        ),
      );
      expect(classified?.code).toBe('database_failure');
      expect(classified?.retryable).toBe(true);
      expect(classified?.message).toBe('Gmail sync persistence failed.');
      expect(classified?.message).not.toContain(code);
      expect(classified?.message).not.toMatch(
        /postgres:\/\/|ya29|commit|expired|Connection string/i,
      );
    }
  });

  it('keeps residual PersistenceError codes as database_failure', () => {
    for (const code of ['NOT_FOUND', 'ORGANIZATION_MISMATCH', 'UNIQUE_VIOLATION'] as const) {
      const classified = classifyGmailPersistenceFailure(
        persistenceError(code, `raw ${code} detail with SQLSTATE 23505`),
      );
      expect(classified?.code).toBe('database_failure');
      expect(classified?.retryable).toBe(true);
      expect(classified?.message).not.toContain(code);
      expect(classified?.message).not.toMatch(/SQLSTATE|23505/i);
    }
  });

  it('does not classify unrelated codes or Gmail sync errors', () => {
    expect(classifyGmailPersistenceFailure(new GmailSyncError('network_failure'))).toBeNull();
    expect(classifyGmailPersistenceFailure(persistenceError('INVALID_STATE', 'nope'))).toBeNull();
    expect(classifyGmailPersistenceFailure(new Error('P2028 looks like a Prisma code'))).toBeNull();
    expect(classifyGmailPersistenceFailure({ message: 'VALIDATION' })).toBeNull();
    expect(classifyGmailPersistenceFailure(null)).toBeNull();
  });
});
