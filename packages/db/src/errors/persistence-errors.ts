export type PersistenceErrorCode =
  | 'NOT_FOUND'
  | 'ORGANIZATION_MISMATCH'
  | 'OPTIMISTIC_CONCURRENCY'
  | 'UNIQUE_VIOLATION'
  | 'VALIDATION'
  | 'TRANSACTION_FAILED'
  /** D080: Approve must not include recipientId in A6. Maps to HTTP 400 in A6.2. */
  | 'RECIPIENT_HANDOFF_NOT_AVAILABLE'
  /** Same Idempotency-Key reused with a conflicting fingerprint (A7). */
  | 'IDEMPOTENCY_KEY_CONFLICT'
  /** Durable handoff attempt already pending for this key/task (A7). */
  | 'HANDOFF_IN_PROGRESS'
  /** Domain/state conflict for handoff transitions (A7). */
  | 'DOMAIN_CONFLICT'
  /** Illegal attempt lifecycle transition (A7). */
  | 'INVALID_STATE';

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export function notFound(message: string): PersistenceError {
  return new PersistenceError('NOT_FOUND', message);
}

export function organizationMismatch(message: string): PersistenceError {
  return new PersistenceError('ORGANIZATION_MISMATCH', message);
}

export function optimisticConcurrency(message: string): PersistenceError {
  return new PersistenceError('OPTIMISTIC_CONCURRENCY', message);
}

export function uniqueViolation(message: string): PersistenceError {
  return new PersistenceError('UNIQUE_VIOLATION', message);
}

export function persistenceValidation(message: string): PersistenceError {
  return new PersistenceError('VALIDATION', message);
}

export function recipientHandoffNotAvailable(
  message = 'Approve must not include recipientId in A6 (D080).',
): PersistenceError {
  return new PersistenceError('RECIPIENT_HANDOFF_NOT_AVAILABLE', message);
}

export function idempotencyKeyConflict(message: string): PersistenceError {
  return new PersistenceError('IDEMPOTENCY_KEY_CONFLICT', message);
}

export function handoffInProgress(message: string): PersistenceError {
  return new PersistenceError('HANDOFF_IN_PROGRESS', message);
}

export function domainConflict(message: string): PersistenceError {
  return new PersistenceError('DOMAIN_CONFLICT', message);
}

export function invalidState(message: string): PersistenceError {
  return new PersistenceError('INVALID_STATE', message);
}

/**
 * Whether a thrown error is a `PersistenceError`, decided inside this module.
 *
 * The predicate exists so that callers outside `packages/db` never need the class itself. Two
 * distinct hazards make that worth a function.
 *
 * The first is packaging. `@aicaa/db` is listed in `serverExternalPackages`, so a *value* imported
 * from it by `apps/web` does not reliably survive the Next build — A8.7b-INCIDENT-1d shipped
 * `NO_SCHEDULE_REMINDER_VERSION` as an undeclared free variable and every reminder verb threw
 * `ReferenceError`. A class used only for `instanceof` is exactly that kind of value.
 *
 * The second is module identity, and it is the one a source reviewer cannot see. `apps/web` reaches
 * persistence through the traced `dist/runtime.js`, resolved at runtime from a file path, while a
 * static `@aicaa/db` import resolves through `dist/index.js`. Those are different entry files, and
 * in the deployed Lambda layout there is no guarantee they share one module graph. If they do not,
 * `error instanceof PersistenceError` is silently **false** for an error this package threw — no
 * crash, no diagnostic, just a `UNIQUE_VIOLATION` that stops being recognised as one.
 *
 * Deciding it here removes both: the comparison happens in the same module instance that
 * constructed the error, and the caller imports a function through the runtime bridge instead of a
 * class through the bundler.
 */
export function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError;
}

/**
 * Whether a thrown error is PostgreSQL refusing to serialize concurrent writes.
 *
 * Deadlock (`40P01`) and serialization failure (`40001`) are not faults — they are the database
 * correctly telling one of two racing transactions to give up. The A8.3b audit found them escaping
 * as a generic 500, which taught a caller that the server was broken when the truthful answer was
 * "someone else changed this first, read it again".
 *
 * Prisma reports them inconsistently depending on driver and shape: sometimes as `P2034`
 * ("write conflict or deadlock"), sometimes as an unknown request error whose message carries the
 * raw SQLSTATE. Both are matched, and the SQLSTATE is matched as a whole token so an unrelated
 * message containing those digits cannot be mistaken for a conflict.
 */
export function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === 'P2034') {
    return true;
  }
  return /\b(40P01|40001)\b/.test(error.message) || /deadlock detected/i.test(error.message);
}

/**
 * Re-throw a serialization failure as an optimistic-concurrency failure, leaving anything else
 * untouched. Callers get the retryable concurrency code their HTTP boundary already maps to 412.
 */
export function rethrowAsConcurrencyFailure(error: unknown, context: string): never {
  if (isSerializationFailure(error)) {
    throw optimisticConcurrency(`${context} lost a concurrent write race; re-read and retry.`);
  }
  throw error;
}
