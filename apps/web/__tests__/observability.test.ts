// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonErrorResponse, unauthorizedResponse } from '@/lib/auth/http';
import { jsonErrorResponseWithDetails, mapOwnerTaskRouteError } from '@/lib/http/errors';
import {
  assertNoCapabilitySecretInDiagnostic,
  createRequestId,
  emitOperationalLog,
  getRequestId,
  isNextControlFlowError,
  isNextNotFoundControlFlowError,
  logOperationalFailure,
  looksLikeRawCapabilityPath,
  runWithRequestContext,
  setOperationalLogSinkForTests,
  toSafeRouteTemplate,
  withOperationTiming,
} from '@/lib/observability';
import { TaskServiceError } from '@/lib/tasks/errors';

describe('P1.1 observability — route templates (D114)', () => {
  it('scrubs capability browser paths', () => {
    const token = 'a'.repeat(43);
    expect(toSafeRouteTemplate(`/c/${token}`)).toBe('/c/[token]');
    expect(toSafeRouteTemplate(`/c/${token}/extra`)).toBe('/c/[token]/extra');
  });

  it('scrubs capability API paths and resource ids', () => {
    const token = 'b'.repeat(43);
    expect(toSafeRouteTemplate(`/api/v1/capabilities/${token}/tasks/task_abc/notes`)).toBe(
      '/api/v1/capabilities/[token]/tasks/[taskId]/notes',
    );
  });

  it('scrubs absolute URLs, query strings, and trailing segments', () => {
    const token = 'c'.repeat(43);
    expect(toSafeRouteTemplate(`https://example.com/c/${token}?utm=1#frag`)).toBe('/c/[token]');
    expect(toSafeRouteTemplate(`/c/${token}?x=1`)).toBe('/c/[token]');
    expect(
      toSafeRouteTemplate(`https://host/api/v1/capabilities/${token}/tasks/task_1/complete`),
    ).toBe('/api/v1/capabilities/[token]/tasks/[taskId]/complete');
  });

  it('detects raw capability paths', () => {
    expect(looksLikeRawCapabilityPath(`/c/${'x'.repeat(40)}`)).toBe(true);
    expect(looksLikeRawCapabilityPath('/c/[token]')).toBe(false);
  });
});

describe('P1.1 observability — AsyncLocalStorage isolation', () => {
  it('isolates concurrent request contexts', async () => {
    const a = createRequestId();
    const b = createRequestId();
    const seen: string[] = [];

    await Promise.all([
      runWithRequestContext({ requestId: a }, async () => {
        await new Promise((r) => setTimeout(r, 15));
        seen.push(`a:${getRequestId()}`);
        expect(getRequestId()).toBe(a);
      }),
      runWithRequestContext({ requestId: b }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`b:${getRequestId()}`);
        expect(getRequestId()).toBe(b);
      }),
    ]);

    expect(seen).toEqual([`b:${b}`, `a:${a}`]);
    expect(getRequestId()).toBeUndefined();
  });

  it('restores parent context after nested run', async () => {
    const parent = createRequestId();
    const child = createRequestId();
    await runWithRequestContext({ requestId: parent, operation: 'parent' }, async () => {
      expect(getRequestId()).toBe(parent);
      await runWithRequestContext({ requestId: child, operation: 'child' }, async () => {
        expect(getRequestId()).toBe(child);
      });
      expect(getRequestId()).toBe(parent);
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('falls back safely when no context exists', () => {
    expect(getRequestId()).toBeUndefined();
    const captured: string[] = [];
    setOperationalLogSinkForTests((line) => {
      captured.push(line);
    });
    try {
      const record = emitOperationalLog({
        event: 'operation_timing',
        level: 'info',
        operation: 'outside_context',
        durationMs: 1,
        outcome: 'ok',
      });
      expect(record?.requestId).toBeUndefined();
      expect(record?.operation).toBe('outside_context');
      expect(captured).toHaveLength(1);
    } finally {
      setOperationalLogSinkForTests(null);
    }
  });
});

describe('P1.1 observability — unified correlation in error envelopes (D115)', () => {
  it('reuses the request-scoped requestId in jsonErrorResponse', async () => {
    const requestId = createRequestId();
    await runWithRequestContext({ requestId, correlationId: null }, async () => {
      const response = jsonErrorResponse('VALIDATION_ERROR', 'bad', 400);
      const body = await response.json();
      expect(body.error.requestId).toBe(requestId);
      expect(body.error.correlationId).toBeNull();
    });
  });

  it('reuses the request-scoped requestId in jsonErrorResponseWithDetails', async () => {
    const requestId = createRequestId();
    await runWithRequestContext({ requestId, correlationId: null }, async () => {
      const response = jsonErrorResponseWithDetails('DOMAIN_CONFLICT', 'conflict', 409);
      const body = await response.json();
      expect(body.error.requestId).toBe(requestId);
    });
  });

  it('reuses context for unauthorizedResponse', async () => {
    const requestId = createRequestId();
    await runWithRequestContext({ requestId }, async () => {
      const response = unauthorizedResponse();
      const body = await response.json();
      expect(body.error.requestId).toBe(requestId);
      expect(response.status).toBe(401);
    });
  });

  it('mints a UUID only when no diagnostic context exists', async () => {
    const response = jsonErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    const body = await response.json();
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('does not copy requestId into correlationId', async () => {
    const requestId = createRequestId();
    await runWithRequestContext({ requestId, correlationId: null }, async () => {
      const response = jsonErrorResponse('INTERNAL_ERROR', 'x', 500);
      const body = await response.json();
      expect(body.error.requestId).toBe(requestId);
      expect(body.error.correlationId).toBeNull();
      expect(body.error.correlationId).not.toBe(body.error.requestId);
    });
  });

  it('preserves requestId through mapOwnerTaskRouteError', async () => {
    const requestId = createRequestId();
    await runWithRequestContext({ requestId }, async () => {
      const response = mapOwnerTaskRouteError(new TaskServiceError('NOT_FOUND', 'Task not found.'));
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.error.requestId).toBe(requestId);
    });
  });

  it('explicit ids override context', async () => {
    const contextId = createRequestId();
    const overrideId = createRequestId();
    await runWithRequestContext({ requestId: contextId }, async () => {
      const response = jsonErrorResponse('INTERNAL_ERROR', 'x', 500, {
        requestId: overrideId,
      });
      const body = await response.json();
      expect(body.error.requestId).toBe(overrideId);
    });
  });
});

describe('P1.1 observability — structured diagnostics', () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    setOperationalLogSinkForTests((line) => {
      lines.push(line);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setOperationalLogSinkForTests(null);
    vi.restoreAllMocks();
  });

  it('emits expected safe fields including requestId', async () => {
    const requestId = createRequestId();
    await runWithRequestContext(
      { requestId, routeTemplate: '/tasks', operation: 'owner_task_route' },
      async () => {
        const record = emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          durationMs: 12.5,
          outcome: 'ok',
        });
        expect(record).toMatchObject({
          event: 'operation_timing',
          level: 'info',
          requestId,
          routeTemplate: '/tasks',
          operation: 'owner_task_route',
          durationMs: 12.5,
          outcome: 'ok',
        });
        expect(lines.length).toBe(1);
        const parsed = JSON.parse(lines[0]!);
        expect(parsed.requestId).toBe(requestId);
        expect(parsed).not.toHaveProperty('stack');
        expect(parsed).not.toHaveProperty('message');
        expect(JSON.stringify(parsed)).not.toMatch(/postgresql:\/\//i);
      },
    );
  });

  it('routes error-level records through the sink (not only console)', () => {
    emitOperationalLog({
      event: 'operational_failure',
      level: 'error',
      category: 'DATABASE_FAILURE',
      outcome: 'error',
    });
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).event).toBe('operational_failure');
  });

  it('sanitizes non-finite durations', () => {
    const record = emitOperationalLog({
      event: 'operation_timing',
      level: 'info',
      durationMs: Number.NaN,
      outcome: 'ok',
    });
    expect(record?.durationMs).toBe(0);
  });

  it('never emits a raw capability path in diagnostics', async () => {
    const token = 'TokEnSecretValueWithEnoughLength1234567890ab';
    const record = emitOperationalLog({
      event: 'operational_failure',
      level: 'error',
      routeTemplate: `/c/${token}`,
      category: 'AUTHZ_FAILURE',
      outcome: 'error',
    });
    expect(record?.routeTemplate).toBe('/c/[token]');
    assertNoCapabilitySecretInDiagnostic(record, 'operational record');
    expect(looksLikeRawCapabilityPath(JSON.stringify(record))).toBe(false);
  });

  it('does not log expected domain 4xx as operational_failure', () => {
    logOperationalFailure(new TaskServiceError('NOT_FOUND', 'Task not found.'), {
      operation: 'owner_task_route',
      routePathname: '/api/v1/tasks/task_1',
    });
    logOperationalFailure(new TaskServiceError('VALIDATION_ERROR', 'bad'), {
      operation: 'owner_task_route',
    });
    logOperationalFailure(new TaskServiceError('PRECONDITION_FAILED', 'etag'), {
      operation: 'owner_task_route',
    });
    expect(lines.filter((l) => JSON.parse(l).event === 'operational_failure')).toHaveLength(0);
  });

  it('withOperationTiming emits non-negative duration', async () => {
    await withOperationTiming('unit_timing_probe', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe('operation_timing');
    expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    expect(parsed.outcome).toBe('ok');
  });

  it('does not throw when the sink throws', () => {
    setOperationalLogSinkForTests(() => {
      throw new Error('sink boom');
    });
    expect(() =>
      emitOperationalLog({
        event: 'operation_timing',
        level: 'info',
        durationMs: 1,
        outcome: 'ok',
      }),
    ).not.toThrow();
  });
});

describe('P1.1 observability — Next.js control-flow detection', () => {
  it('recognizes redirect and not-found digests', () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    const notFound = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK'), {
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(isNextControlFlowError(redirect)).toBe(true);
    expect(isNextControlFlowError(notFound)).toBe(true);
    expect(isNextNotFoundControlFlowError(notFound)).toBe(true);
    expect(isNextNotFoundControlFlowError(redirect)).toBe(false);
    expect(isNextControlFlowError(new Error('plain'))).toBe(false);
  });
});
