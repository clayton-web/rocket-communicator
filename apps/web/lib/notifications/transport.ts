import 'server-only';

/**
 * The Owner notification transport seam (A8.5b).
 *
 * A8.5b builds the delivery lifecycle that will eventually carry a real send, and deliberately does
 * not build the send. This interface is the line between them: the processing service depends on it,
 * the fail-closed fake below satisfies it, and A8.5c will add a Gmail implementation without the
 * service learning anything new.
 *
 * Nothing in this file or its consumers imports Gmail, googleapis, a MIME builder, an access-token
 * resolver, or any provider SDK, and `apps/web/__tests__/a8-5b-notification-guards.test.ts` fails
 * the build if that changes.
 *
 * ## Why this is not `ReminderTransport`
 *
 * The two interfaces look similar and mean different things, and the difference is `ambiguous`.
 *
 * A reminder treats an ambiguous provider answer as **sent**, because D106 caps deliveries per
 * generation and a Recipient hearing about the same morning twice is the worse failure. An Owner
 * notification treats the same answer as **terminal and requiring attention**, because nothing is
 * capped here and reporting a delivery that may never have happened is the worse untruth (D135).
 *
 * Sharing one interface would put those two readings behind one word and invite a future change to
 * either to quietly apply to both.
 */

/**
 * What the transport can say, in terms of what the caller may do next.
 *
 * - `accepted` — the provider has the message. Terminal, and the only outcome that may be reported
 *   as delivered.
 * - `retryable` — definitively not sent, and trying again is safe.
 * - `permanent` — definitively not sent, and trying again would fail the same way.
 * - `ambiguous` — the transport cannot say. Terminal and never retried, because the provider may
 *   already have accepted it (D135).
 */
export type OwnerNotificationTransportResult =
  | { readonly kind: 'accepted'; readonly providerMessageRef: string }
  | { readonly kind: 'retryable'; readonly failureCode: string }
  | { readonly kind: 'permanent'; readonly failureCode: string }
  | { readonly kind: 'ambiguous'; readonly failureCode: string };

/**
 * What a transport is told about a notification.
 *
 * Identity only. There is no destination address, no subject, no body, no rendered content, and no
 * field one could be smuggled through — A8.5c resolves the address from the connected
 * `CommunicationAccount` at send time (D134) and composes the message itself. There is likewise no
 * capability token, capability URL, `/c/` path, Recipient note, or excerpt, so D130's prohibitions
 * are enforced by the shape of this type as well as by the code that fills it.
 */
export interface OwnerNotificationTransportRequest {
  /** Opaque intent identity. Never an address, subject, or body. */
  readonly intentId: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly subjectKind: string;
  /** Opaque subject identity. A Task id, not a Task summary. */
  readonly subjectId: string;
  /** 1-based provider call number for this intent, for transport-side idempotency. */
  readonly attemptNumber: number;
}

export interface OwnerNotificationTransport {
  send(request: OwnerNotificationTransportRequest): Promise<OwnerNotificationTransportResult>;
}

/** A scripted outcome, or `throw` to exercise the service's exception classification. */
export type ScriptedOwnerNotificationOutcome = OwnerNotificationTransportResult | 'throw';

/**
 * Deterministic in-memory transport for tests and for the disabled production path.
 *
 * **Fail-closed by default.** With no script, every call reports `permanent` rather than `accepted`.
 * A fake that succeeds by default is a fake that makes a broken service look healthy, and worse, it
 * would let a test assert a delivery the code never really performed. The default here is the answer
 * that cannot be mistaken for a delivery.
 *
 * Scripted outcomes are consumed in order; once the script is spent the default resumes, so a test
 * that under-specifies its script fails closed rather than silently repeating the last answer.
 */
export class FakeOwnerNotificationTransport implements OwnerNotificationTransport {
  private readonly script: ScriptedOwnerNotificationOutcome[];

  readonly calls: OwnerNotificationTransportRequest[] = [];

  constructor(script: readonly ScriptedOwnerNotificationOutcome[] = []) {
    this.script = [...script];
  }

  async send(
    request: OwnerNotificationTransportRequest,
  ): Promise<OwnerNotificationTransportResult> {
    this.calls.push(request);
    const next = this.script.shift();

    if (next === 'throw') {
      throw new Error('scripted transport failure');
    }
    if (next) {
      return next;
    }
    return { kind: 'permanent', failureCode: 'fake_transport_unscripted' };
  }
}
