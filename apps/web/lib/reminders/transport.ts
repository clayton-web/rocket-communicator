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
  /**
   * Outcome for Tasks with no explicit script.
   *
   * Defaults to a permanent configuration failure, never to acceptance (A8.4a audit H3).
   */
  readonly defaultResult?: ReminderTransportResult;
  /** Keyed by Task id, because occurrence ids are minted by the service at claim time. */
  readonly scripts?: ReadonlyMap<string, FakeTransportScript>;
}

/**
 * What an unscripted fake reports (A8.4a audit H3).
 *
 * The default used to be `accepted`. Nothing constructed one in production — the flag is off and
 * the endpoint is undeployed — but the *default* was the wrong shape for a safety foundation: a
 * single environment variable away from a system that recorded successful deliveries, incremented
 * the D106 count toward its ceiling of fourteen, and advanced every schedule, while sending
 * absolutely nothing. An unconfigured transport claiming success is the one failure a delivery
 * system must not be able to have, because there is no downstream check that would catch it.
 *
 * `permanent` rather than `retryable`: an unconfigured deployment does not become configured by
 * being asked again, and three attempts against a missing transport would burn an occurrence's
 * budget for no reason. Permanent stops the schedule and raises Owner attention, which is the
 * truthful outcome — somebody has to go and configure a transport.
 */
const UNCONFIGURED_TRANSPORT_RESULT: ReminderTransportResult = {
  kind: 'permanent',
  failureCode: 'transport_not_configured',
};

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
 *
 * The processing service cannot construct one of these. It has no import of this class and refuses
 * to run without an injected transport, so the only way a fake reaches the occurrence lifecycle is
 * a test handing it one deliberately — which is the guarantee `a8-4a-worker-safety-guards.test.ts`
 * checks structurally rather than trusting.
 */
export class FakeReminderTransport implements ReminderTransport {
  private readonly defaultResult: ReminderTransportResult;
  private readonly scripts: ReadonlyMap<string, FakeTransportScript>;
  /** Every request this transport was actually asked to send, in order. */
  readonly calls: ReminderTransportRequest[] = [];

  constructor(options: FakeReminderTransportOptions = {}) {
    this.defaultResult = options.defaultResult ?? UNCONFIGURED_TRANSPORT_RESULT;
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
