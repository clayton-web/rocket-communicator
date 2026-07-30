/**
 * Shared browser request timeout for Owner and Recipient API calls (P1.3 / D112).
 *
 * A request that never returns must not leave a control stuck "in progress" forever,
 * and a transport failure must never be reported as a confirmed server outcome.
 */

/**
 * Single documented timeout for every browser-side API request.
 *
 * Derived from the slowest route rather than picked as a round number. The slowest Owner
 * operation is `POST /api/v1/tasks/{taskId}/handoff`, which persists and then performs a
 * live Gmail send that the server itself bounds at `GMAIL_SEND_TIMEOUT_MS` (30s, see
 * `lib/gmail/gmail-api-client.ts`). Giving up before the server's own budget would report
 * a handoff that is still running — and will very likely succeed — as ambiguous, which is
 * exactly the misleading outcome D112 exists to prevent. 35 seconds clears that budget
 * with room for the surrounding persistence and audit writes, so the client only stops
 * waiting once the server can no longer produce an answer.
 *
 * `owner-api-client.test.ts` asserts this stays above the Gmail send budget so the two
 * cannot drift apart.
 */
export const CLIENT_REQUEST_TIMEOUT_MS = 35_000;

/** Raised only when this helper's own timer elapsed — never for a caller-initiated abort. */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError;
}

/**
 * `fetch` bounded by {@link CLIENT_REQUEST_TIMEOUT_MS}.
 *
 * Performs exactly one request and never retries, so it cannot turn a timeout into a
 * duplicate submission. A response of any status — including 4xx, 409, and 412 — is
 * returned untouched so callers keep parsing the server's own error envelope.
 *
 * Uses `AbortController` plus a timer rather than `AbortSignal.timeout`/`AbortSignal.any`,
 * whose composition support is newer than the runtimes this app must work in. An abort
 * raised by a caller-supplied signal is re-thrown unchanged; only this helper's timer
 * produces {@link RequestTimeoutError}.
 *
 * The bound covers reaching a response, not draining its body: the timer is cleared once
 * `fetch` resolves, so a server that sends headers and then stalls the body is not caught
 * here. Every current caller reads small JSON envelopes from this app's own routes.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = CLIENT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? null;
  let timedOut = false;

  const forwardCallerAbort = () => {
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', forwardCallerAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardCallerAbort);
  }
}
