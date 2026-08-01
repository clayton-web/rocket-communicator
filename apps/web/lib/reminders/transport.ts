import 'server-only';

/**
 * The reminder transport seam (A8.4a).
 *
 * A8.4a builds the occurrence lifecycle that will eventually carry a real send, and deliberately
 * does not build the send. This interface is the line between them: the processing service depends
 * on it, the fake implementation below satisfies it, and A8.4b will add a Gmail implementation
 * without the service learning anything new.
 *
 * Nothing in this file or its consumers imports Gmail, googleapis, or any provider SDK, and
 * `apps/web/__tests__/a8-4a-worker-safety-guards.test.ts` fails the build if that changes.
 *
 * ## Why the outcome vocabulary is what it is
 *
 * The four results are not a taxonomy of errors; they are a taxonomy of *what the caller may do
 * next*, which is the only distinction the occurrence lifecycle can act on.
 *
 * - `accepted` — the provider has the message. Durable, counted, never retried.
 * - `retryable` — definitively not sent, and trying again is safe. The occurrence stays owed.
 * - `permanent` — definitively not sent, and trying again would fail the same way.
 * - `ambiguous` — the transport cannot say. Treated as sent, because D106 caps deliveries and a
 *   Recipient hearing about the same morning twice is the worse failure.
 *
 * A transport that throws before returning is handled by the service, not encoded here: whether the
 * throw happened before or after the provider call is a fact about the durable in-flight marker,
 * not about the exception.
 */

export type ReminderTransportResult =
  | { readonly kind: 'accepted'; readonly providerMessageRef: string }
  | { readonly kind: 'retryable'; readonly failureCode: string }
  | { readonly kind: 'permanent'; readonly failureCode: string }
  | { readonly kind: 'ambiguous'; readonly failureCode: string };

export interface ReminderTransportRequest {
  /** Opaque occurrence identity. Never a recipient address, subject, or body. */
  readonly occurrenceId: string;
  readonly taskId: string;
  readonly occurrenceKind: 'advance' | 'overdue';
  readonly occurrenceLocalDate: string;
}

export interface ReminderTransport {
  send(request: ReminderTransportRequest): Promise<ReminderTransportResult>;
}

/** Deterministic scripted outcomes, keyed by Task id — the identity a test controls. */
export type FakeTransportScript =
  | ReminderTransportResult
  | { readonly kind: 'throw_before_call' }
  | { readonly kind: 'crash_after_call_started' }
  | { readonly kind: 'slow'; readonly delayMs: number; readonly then: ReminderTransportResult };

export interface FakeReminderTransportOptions {
  /** Outcome for Tasks with no explicit script. Defaults to `accepted`. */
  readonly defaultResult?: ReminderTransportResult;
  /** Keyed by Task id, because occurrence ids are minted by the service at claim time. */
  readonly scripts?: ReadonlyMap<string, FakeTransportScript>;
}

/**
 * A transport that sends nothing and does exactly what the test told it to (A8.4a).
 *
 * `throw_before_call` and `crash_after_call_started` are the two shapes that matter most, and they
 * are indistinguishable to the caller by design — an exception is an exception. What separates them
 * is whether the durable `provider_call_started_at` marker was committed first, which is why the
 * service writes that marker before invoking this and why recovery reads it rather than reasoning
 * about the error.
 *
 * `slow` exists so a call can be made to outlive its own lease deliberately, which is the only way
 * to exercise the late-finalization fence without sleeping for the real lease duration.
 */
export class FakeReminderTransport implements ReminderTransport {
  private readonly defaultResult: ReminderTransportResult;
  private readonly scripts: ReadonlyMap<string, FakeTransportScript>;
  /** Every request this transport was actually asked to send, in order. */
  readonly calls: ReminderTransportRequest[] = [];

  constructor(options: FakeReminderTransportOptions = {}) {
    this.defaultResult = options.defaultResult ?? {
      kind: 'accepted',
      providerMessageRef: 'fake-accepted',
    };
    this.scripts = options.scripts ?? new Map();
  }

  async send(request: ReminderTransportRequest): Promise<ReminderTransportResult> {
    this.calls.push(request);
    const script = this.scripts.get(request.taskId) ?? this.defaultResult;

    switch (script.kind) {
      case 'throw_before_call':
        throw new Error('fake transport refused before contacting a provider');
      case 'crash_after_call_started':
        throw new Error('fake transport crashed after contacting a provider');
      case 'slow': {
        await new Promise((resolve) => setTimeout(resolve, script.delayMs));
        return script.then;
      }
      default:
        return script;
    }
  }
}
