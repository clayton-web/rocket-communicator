import 'server-only';
import { ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION } from '@aicaa/domain';
import type { OutboundAddress, OutboundMimeMessage } from '../transport/outbound-types';
import { escapeHtml } from './text-utils';

/**
 * A8.5c Owner Event Notification email (D133, D134, D136).
 *
 * Tells the Owner that something happened to work they delegated. It is a **notification**, not a
 * copy of the thing that happened, and the difference is the whole content policy: the message names
 * the event, identifies the Task, says when it happened, says truthfully who acted, and offers a link
 * to the Owner's own authenticated Task page. It quotes nothing.
 *
 * ## Why nothing is quoted, even escaped (D134)
 *
 * A Recipient's note body, a clarification request, a Gmail excerpt — each is text some other person
 * wrote, and putting it in the Owner's inbox under Rocket's own `From` address launders it into
 * something that looks like Rocket said it. Escaping fixes HTML injection and does nothing about
 * that: a Recipient could write "Your accountant asked me to forward the wire details to..." and it
 * would arrive as an assistant-branded email. The prohibition is therefore semantic, and the only
 * safe version is a renderer that has no parameter to put such text in. This one does not.
 *
 * The persisted Task summary is different in kind and is included. A Task has no title — the summary
 * points *are* how a Task is identified in this product — and they are the same privacy-reviewed
 * lines the Owner already reads in the app. Without them "a task was completed" names no task.
 *
 * ## Why a link is allowed here when a reminder carries none (D134 clarifying D130)
 *
 * D130's subject is the capability bearer secret: a Recipient's link *is* a credential, delivered
 * once and stored only as an HMAC, so a reminder could carry one only by minting a second credential
 * or inventing an unauthenticated redirect. An Owner is not a bearer. They authenticate with a
 * session against the application's own origin, so `/tasks/{id}` is not a credential, and anybody
 * following it without a session reaches sign-in rather than Task data. No capability token,
 * capability URL, `/c/` path, or token hash appears here, and {@link assertOwnerLinkSafety} refuses
 * to emit a body containing one.
 */

/** The event vocabulary this renderer must cover, matching the ratified D133 taxonomy exactly. */
export type OwnerNotificationEventType =
  | 'task_completed_by_recipient'
  | 'task_clarification_requested'
  | 'task_returned_to_owner'
  | 'handoff_delivery_failed'
  | 'gmail_disconnected'
  | 'capability_expired'
  | 'reminder_schedule_stopped_ceiling_reached'
  | 'reminder_schedule_stopped_permanent_failure'
  | 'reminder_schedule_stopped_repeated_ambiguous'
  | 'reminder_no_active_assignment';

/**
 * Who caused the event, as the intent recorded it at the time (D133).
 *
 * The historical fact, never re-derived from current Task state: a Task completed by a Recipient and
 * later reopened by the Owner is still a Recipient completion, and reading today's row would say
 * otherwise.
 */
export type OwnerNotificationActorKind = 'owner' | 'capability' | 'system';

export interface OwnerNotificationEmailInput {
  /** The organization's connected Gmail identity. Sender and, for send-to-self, recipient too. */
  readonly from: OutboundAddress;
  readonly to: OutboundAddress;
  readonly eventType: OwnerNotificationEventType;
  readonly actorKind: OwnerNotificationActorKind;
  /** When the event happened, ISO-8601. Rendered in UTC; see {@link formatOccurredAt}. */
  readonly occurredAt: string;
  /**
   * Persisted Task summary points reduced to display lines, already URL-redacted by the caller.
   * Empty when the subject is not a Task or its summary is unavailable.
   */
  readonly summaryLines: readonly string[];
  /**
   * Absolute link to an authenticated Owner surface, or `undefined` when the event has no safe
   * applicable destination. Never a capability URL.
   */
  readonly ownerLink?: string;
}

export class OwnerNotificationEmailContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerNotificationEmailContentError';
  }
}

/** Fixed copy. Nothing below is interpolated from Task, Recipient, or provider data. */
const AUTOMATED_NOTICE =
  'This is an automated notification from your assistant. Nobody typed it, and you do not need to reply to it.';

const NO_QUOTE_EXPLANATION =
  'This notification deliberately does not quote any message text. Open the task to read the full details.';

/**
 * Subject and lead sentence per event.
 *
 * A closed record keyed by the event enum, so the type checker — not a code reviewer, and not a
 * runtime default branch — is what proves every ratified event has copy. Adding an eleventh event to
 * the enum without adding a line here fails the build.
 *
 * The wording uses only what every intent carries: the event type itself. No event-specific field is
 * invented, because A8.5d has not yet defined what those events would persist, and generic-but-true
 * beats specific-but-guessed. Nine of these ten are unreachable today, since
 * `task.completed_by_recipient` is the only producer that exists.
 */
const EVENT_COPY: Record<
  OwnerNotificationEventType,
  { readonly subject: string; readonly lead: string }
> = {
  task_completed_by_recipient: {
    subject: 'Task update: marked complete by the recipient',
    lead: 'The person you delegated this task to has marked it complete.',
  },
  task_clarification_requested: {
    subject: 'Task update: the recipient asked for clarification',
    lead: 'The person you delegated this task to is blocked and has asked you a question.',
  },
  task_returned_to_owner: {
    subject: 'Task update: returned to you',
    lead: 'This task has been returned to you and nobody is currently assigned to it.',
  },
  handoff_delivery_failed: {
    subject: 'Task update: the assignment message could not be delivered',
    lead: 'The assignment message for this task did not reach its recipient, and will not be retried.',
  },
  gmail_disconnected: {
    subject: 'Your assistant lost access to Gmail',
    lead: 'The connected Gmail account is no longer usable, so reading new mail and sending on your behalf have both stopped.',
  },
  capability_expired: {
    subject: 'Task update: the recipient link has expired',
    lead: 'The link the recipient was using for this task has expired, so they can no longer act on it.',
  },
  reminder_schedule_stopped_ceiling_reached: {
    subject: 'Task update: reminders have finished',
    lead: 'Reminders for this task have reached their limit and will not continue.',
  },
  reminder_schedule_stopped_permanent_failure: {
    subject: 'Task update: reminders stopped after a delivery failure',
    lead: 'Reminders for this task have stopped because a reminder could not be delivered.',
  },
  reminder_schedule_stopped_repeated_ambiguous: {
    subject: 'Task update: reminders stopped because delivery could not be confirmed',
    lead: 'Reminders for this task have stopped because several could not be confirmed as delivered, so the recipient may or may not have received them.',
  },
  reminder_no_active_assignment: {
    subject: 'Task update: a reminder has nobody to reach',
    lead: 'A reminder for this task came due while nobody was assigned to it, so it was not sent.',
  },
};

/**
 * Truthful attribution, in the Owner's language (D133, §8).
 *
 * Three kinds, three sentences, and none of them says the Owner did it. `capability` is the case
 * that matters most today: a Recipient completing a Task must never render as "you completed" or as
 * "Rocket completed". The label is the actor *kind* and nothing finer — no Recipient name, address,
 * or capability identifier — which keeps this line inside the same privacy envelope as the rest of
 * the message.
 */
function attributionLine(actorKind: OwnerNotificationActorKind): string {
  switch (actorKind) {
    case 'capability':
      return 'Who acted: the recipient, using the link you sent them.';
    case 'system':
      return 'Who acted: your assistant, automatically.';
    case 'owner':
      return 'Who acted: you, from your own account.';
  }
}

/**
 * Render the occurrence instant.
 *
 * UTC, explicitly labelled. The organization timezone is the scheduling authority for reminders
 * (D103) and this is not a reminder: an event notification states when something happened, and a
 * timestamp that silently used a different zone than it claimed would be worse than an obviously
 * absolute one. The Task page shows local time.
 */
export function formatOccurredAt(occurredAt: string): string {
  const parsed = Date.parse(occurredAt);
  if (!Number.isFinite(parsed)) {
    throw new OwnerNotificationEmailContentError(
      'Owner notification requires a valid event occurrence instant.',
    );
  }
  return `${new Date(parsed).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** Anything that could function as a capability credential, however it is spelled (D109, D114). */
const CAPABILITY_PATH_LIKE = /\/c\//i;

/**
 * Refuse to emit a body carrying a capability surface, and refuse a link that is not ours.
 *
 * The last line of defence, and the only one that still holds when the offending text arrived from
 * the database rather than from this file. Throwing is correct: the transport maps a build failure
 * to a non-retryable outcome and makes no provider call, so content that cannot be rendered safely
 * produces a truthful failure instead of an email that breaks a ratified decision.
 */
function assertOwnerLinkSafety(
  body: string,
  alternative: 'text' | 'html',
  ownerLink?: string,
): void {
  if (CAPABILITY_PATH_LIKE.test(body)) {
    throw new OwnerNotificationEmailContentError(
      `Owner notification ${alternative} body contains a capability path, which D109 forbids.`,
    );
  }
  // Every URL in the body must be the one authenticated Owner link we chose. A second one could
  // only have arrived inside a summary point, which is exactly the case the caller's redaction pass
  // is supposed to have handled and this assertion exists to catch when it has not.
  //
  // The character class stops at quotes and angle brackets so an HTML anchor reads as two
  // occurrences of one URL rather than one run-on string that would match nothing and pass.
  const urls = body.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi) ?? [];
  for (const url of urls) {
    if (!ownerLink || url !== ownerLink) {
      throw new OwnerNotificationEmailContentError(
        `Owner notification ${alternative} body contains an unexpected URL.`,
      );
    }
  }
}

/**
 * Validate the Owner link before it is rendered.
 *
 * `https` (or loopback `http` for local development), no capability path, no credentials in the
 * authority, and no control characters. A link is the one piece of this message a mail client will
 * turn into something clickable, so it is the one piece worth refusing outright when it looks wrong.
 */
export function assertSafeOwnerLink(link: string): string {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new OwnerNotificationEmailContentError('Owner notification link is not a valid URL.');
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new OwnerNotificationEmailContentError('Owner notification link must use https.');
  }
  if (parsed.username || parsed.password) {
    throw new OwnerNotificationEmailContentError('Owner notification link carries credentials.');
  }
  if (CAPABILITY_PATH_LIKE.test(parsed.pathname)) {
    throw new OwnerNotificationEmailContentError(
      'Owner notification link points at a capability surface.',
    );
  }
  if (parsed.search || parsed.hash) {
    // No query string and no fragment. Neither is needed to identify a Task, and both are the
    // natural place a token would end up if a later change started passing one.
    throw new OwnerNotificationEmailContentError(
      'Owner notification link must carry no query or fragment.',
    );
  }
  return parsed.toString();
}

function buildPlainText(input: OwnerNotificationEmailInput, copy: { lead: string }): string {
  const lines: string[] = [AUTOMATED_NOTICE, '', copy.lead, ''];

  if (input.summaryLines.length > 0) {
    lines.push('Task summary:');
    for (const line of input.summaryLines) {
      lines.push(`- ${line}`);
    }
    lines.push('');
  }

  lines.push(attributionLine(input.actorKind));
  lines.push(`When: ${formatOccurredAt(input.occurredAt)}`);

  if (input.ownerLink) {
    lines.push('', `Open in your assistant: ${input.ownerLink}`);
  }

  lines.push('', NO_QUOTE_EXPLANATION);
  return lines.join('\n');
}

function buildHtml(input: OwnerNotificationEmailInput, copy: { lead: string }): string {
  const parts: string[] = ['<!DOCTYPE html>', '<html><body>'];
  parts.push(`<p>${escapeHtml(AUTOMATED_NOTICE)}</p>`);
  parts.push(`<p>${escapeHtml(copy.lead)}</p>`);

  if (input.summaryLines.length > 0) {
    parts.push('<p><strong>Task summary</strong></p>');
    parts.push('<ul>');
    for (const line of input.summaryLines) {
      parts.push(`<li>${escapeHtml(line)}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push(`<p>${escapeHtml(attributionLine(input.actorKind))}</p>`);
  parts.push(`<p>${escapeHtml(`When: ${formatOccurredAt(input.occurredAt)}`)}</p>`);

  if (input.ownerLink) {
    // The href and the visible text are the same validated absolute URL, so the message cannot show
    // one destination and navigate to another. No tracking pixel and no remote image: this email
    // reports nothing about whether it was opened.
    const href = escapeHtml(input.ownerLink);
    parts.push(`<p><a href="${href}">${href}</a></p>`);
  }

  parts.push(`<p>${escapeHtml(NO_QUOTE_EXPLANATION)}</p>`);
  parts.push('</body></html>');
  return parts.join('\n');
}

/**
 * Build the Owner Event Notification message.
 *
 * Returns an {@link OutboundMimeMessage} for the reason the reminder builder does: this is not an A7
 * handoff, so it has no `HandoffDeliveryPath`, and inventing one to satisfy the MIME builder would
 * write a false value into A7's acceptance record. No `threadId`, no `In-Reply-To`, no `References`,
 * no CC, no BCC, and exactly one recipient.
 *
 * `rocketGenerated` is the D136 marker, and it is set here rather than by the transport so that no
 * path exists which builds this message without it — an unmarked Owner notification is precisely the
 * message that would be ingested back into A6.
 */
export function buildOwnerNotificationEmail(
  input: OwnerNotificationEmailInput,
): OutboundMimeMessage {
  const copy = EVENT_COPY[input.eventType];
  if (!copy) {
    // Unreachable through the type system, and reachable from a database row carrying an enum value
    // this build does not know. Failing closed is right: the alternative is an email whose subject
    // line is `undefined`.
    throw new OwnerNotificationEmailContentError(
      'Owner notification event type has no ratified copy.',
    );
  }

  const ownerLink = input.ownerLink ? assertSafeOwnerLink(input.ownerLink) : undefined;
  const normalized = { ...input, ownerLink };

  const textBody = buildPlainText(normalized, copy);
  const htmlBody = buildHtml(normalized, copy);
  assertOwnerLinkSafety(textBody, 'text', ownerLink);
  assertOwnerLinkSafety(htmlBody, 'html', ownerLink);

  return {
    from: input.from,
    to: input.to,
    subject: copy.subject,
    textBody,
    htmlBody,
    rocketGenerated: ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION,
  };
}

/** The exact subject a given event renders, for tests and for callers that need it without a build. */
export function ownerNotificationSubject(eventType: OwnerNotificationEventType): string {
  return EVENT_COPY[eventType].subject;
}
