import { emitOperationalLog } from './log';

/** Monotonic milliseconds suitable for duration measurement. */
export function monotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  const ns = process.hrtime.bigint();
  return Number(ns) / 1e6;
}

export function elapsedMs(startedAt: number): number {
  const value = monotonicNowMs() - startedAt;
  return value < 0 ? 0 : value;
}

/**
 * Time an async operation and emit a privacy-safe timing diagnostic (D115).
 * Never throws from the diagnostic path; rethrows the operation error.
 */
export async function withOperationTiming<T>(
  operation: string,
  fn: () => Promise<T>,
  options?: { routeTemplate?: string; requestId?: string },
): Promise<T> {
  const started = monotonicNowMs();
  try {
    const result = await fn();
    emitOperationalLog({
      event: 'operation_timing',
      level: 'info',
      operation,
      routeTemplate: options?.routeTemplate,
      requestId: options?.requestId,
      durationMs: roundMs(elapsedMs(started)),
      outcome: 'ok',
    });
    return result;
  } catch (error) {
    emitOperationalLog({
      event: 'operation_timing',
      level: 'error',
      operation,
      routeTemplate: options?.routeTemplate,
      requestId: options?.requestId,
      durationMs: roundMs(elapsedMs(started)),
      outcome: 'error',
    });
    throw error;
  }
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
