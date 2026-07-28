import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequestId } from './ids';

/**
 * Request-scoped diagnostic context (P1.1 / D115).
 *
 * `requestId` is the join key across the public error envelope, structured
 * diagnostics, and AuditEvent.requestId where an audit row is written.
 * `correlationId` remains a separate optional parent/trace field and is not
 * collapsed into requestId.
 */
export interface RequestDiagnosticContext {
  requestId: string;
  /** Optional parent/trace id; null/undefined means none. Never equals a capability token. */
  correlationId?: string | null;
  /** Safe route template — never a raw `/c/{token}` path (D114). */
  routeTemplate?: string;
  /** Stable operation name for timing and failure records. */
  operation?: string;
}

export type RequestContextInit = Partial<RequestDiagnosticContext>;

const storage = new AsyncLocalStorage<RequestDiagnosticContext>();

export function getRequestContext(): RequestDiagnosticContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function getCorrelationId(): string | null | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Run `fn` under a request diagnostic context.
 * If `init.requestId` is omitted, inherits from a parent store or mints a new UUID.
 */
export function runWithRequestContext<T>(init: RequestContextInit, fn: () => T): T {
  const parent = storage.getStore();
  const context: RequestDiagnosticContext = {
    requestId: init.requestId ?? parent?.requestId ?? createRequestId(),
    correlationId:
      init.correlationId !== undefined ? init.correlationId : (parent?.correlationId ?? null),
    routeTemplate: init.routeTemplate ?? parent?.routeTemplate,
    operation: init.operation ?? parent?.operation,
  };
  return storage.run(context, fn);
}
