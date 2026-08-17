const PRISMA_TRANSACTION_DURATION_MS_KEY = 'prismaTransactionDurationMs';

export function sanitizePrismaTransactionDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

/**
 * Attach the measured interactive-transaction wall time without wrapping the
 * original exception or changing its enumerable/public Prisma fields.
 */
export function attachPrismaTransactionDurationMs(error: unknown, durationMs: number): void {
  const sanitized = sanitizePrismaTransactionDurationMs(durationMs);
  if (sanitized === undefined) {
    return;
  }
  if (error === null || error === undefined) {
    return;
  }
  if (typeof error !== 'object' && typeof error !== 'function') {
    return;
  }
  try {
    Object.defineProperty(error, PRISMA_TRANSACTION_DURATION_MS_KEY, {
      value: sanitized,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  } catch {
    // Frozen/sealed errors must still propagate unchanged.
  }
}

export function readPrismaTransactionDurationMs(error: unknown): number | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (typeof error !== 'object' && typeof error !== 'function') {
    return undefined;
  }
  try {
    return sanitizePrismaTransactionDurationMs(
      Reflect.get(error, PRISMA_TRANSACTION_DURATION_MS_KEY),
    );
  } catch {
    return undefined;
  }
}
