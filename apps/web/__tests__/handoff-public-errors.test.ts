import { describe, expect, it } from 'vitest';
import {
  classifyHandoffPublicError,
  parsePublicErrorResponse,
} from '@/lib/handoff/client/public-errors';

describe('A7.8 public error parser', () => {
  it('maps retryable and permanent delivery failures by status + code', () => {
    const retryable = classifyHandoffPublicError(503, 'HANDOFF_DELIVERY_FAILED');
    expect(retryable.outcomeCategory).toBe('retryable_failure');
    expect(retryable.allowSameKeyRetry).toBe(true);

    const permanent = classifyHandoffPublicError(400, 'HANDOFF_DELIVERY_FAILED');
    expect(permanent.outcomeCategory).toBe('permanent_failure');
    expect(permanent.allowSameKeyRetry).toBe(false);
  });

  it('treats ambiguous and in-progress as same-key only', () => {
    const ambiguous = classifyHandoffPublicError(503, 'DEPENDENCY_UNAVAILABLE');
    expect(ambiguous.outcomeCategory).toBe('ambiguous');
    expect(ambiguous.allowSameKeyRetry).toBe(true);
    expect(ambiguous.allowNewOperation).toBe(false);
    expect(ambiguous.message).not.toMatch(/failed|succeeded|still sending/i);

    const pending = classifyHandoffPublicError(409, 'HANDOFF_IN_PROGRESS');
    expect(pending.outcomeCategory).toBe('in_progress');
    expect(pending.allowNewOperation).toBe(false);
  });

  it('does not silently rotate on idempotency conflict', () => {
    const conflict = classifyHandoffPublicError(409, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(conflict.allowNewOperation).toBe(false);
    expect(conflict.refetchTask).toBe(true);
  });

  it('ignores unknown details and never surfaces raw provider text from body', () => {
    const parsed = parsePublicErrorResponse(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Google said: invalid_grant raw token abc',
        details: [{ field: 'x', message: 'secret' }],
        requestId: '00000000-0000-0000-0000-000000000001',
      },
    });
    expect(parsed.message).not.toContain('invalid_grant');
    expect(parsed.message).not.toContain('raw token');
  });

  it('falls back safely for malformed bodies', () => {
    const parsed = parsePublicErrorResponse(502, '<html>bad gateway</html>');
    expect(parsed.code).toBe('UNKNOWN');
    expect(parsed.allowNewOperation).toBe(false);
  });
});
