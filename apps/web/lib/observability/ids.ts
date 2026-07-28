import { randomUUID } from 'node:crypto';

/**
 * Mint a new request identifier (UUID).
 * Distinct from: audit event IDs, provider message IDs, Idempotency-Key values,
 * and optional parent correlation IDs (D115).
 */
export function createRequestId(): string {
  return randomUUID();
}
