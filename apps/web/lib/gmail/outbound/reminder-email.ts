import 'server-only';
import type { OutboundAddress, OutboundMimeMessage } from '../transport/outbound-types';
import { escapeHtml } from './text-utils';

/**
 * A8.4b.1 reminder-email builder (D129, D130).
 *
 * A reminder is a nudge, not a second delivery of the work. It restates what the Recipient already
 * received, says when it was due, and points back at the email that can actually act on it. That is
 * the whole message, and the list below is exhaustive rather than illustrative:
 *
 * 1. a statement that this is an automated reminder;
 * 2. the persisted, privacy-reviewed Task summary points;
 * 3. the organization-local due date and the named organization timezone;
 * 4. an instruction to use the original assignment email to open or act on the Task;
 * 5. an explanation of what stops reminders.
 *
 * ## Why there is no link (D130)
 *
 * The capability that makes a Task actionable is a bearer secret delivered exactly once, in the
 * assignment email, and its raw value is not recoverable from the database — only an HMAC of it is
 * stored. A reminder could therefore only carry a link by minting a *new* capability or by inventing
 * a redirect surface, and D130 declined both: a second bearer secret per reminder multiplies the
 * number of live credentials by the number of reminders, and an unauthenticated redirect is a new
 * attack surface added for convenience. So the reminder carries no link at all, and the worker
 * refuses to send one when the original capability is no longer actionable — because a reminder
 * whose only instruction points at a dead link is worse than silence.
 *
 * ## Why URLs are redacted rather than trusted (D130)
 *
 * Summary points are authorized content, and they are also *derived from a real communication*. A
 * point can legitimately read "pay the invoice at https://vendor.example/inv/993". Rendering that
 * verbatim would put a URL into a message D130 says carries none, and no amount of care at the call
 * site fixes it, because the value arrives from the database rather than from this code. So every
 * rendered line is passed through {@link redactUrls} and the result is asserted before the message is
 * returned. The Recipient loses nothing: the original assignment email still has the full content.
 */

export interface ReminderEmailInput {
  /** Owner Gmail identity (sender), resolved once per invocation by the access resolver. */
  readonly from: OutboundAddress;
  /** The address the original assignment email went to (the capability's intended recipient). */
  readonly to: OutboundAddress;
  /** Persisted Task summary points, already reduced to display lines. */
  readonly summaryLines: readonly string[];
  /** Organization-local calendar date, canonical `YYYY-MM-DD` (D103). Never an instant. */
  readonly dueLocalDate: string;
  /** Named IANA organization timezone the due date is expressed in (D103). */
  readonly timeZone: string;
}

/** Anything that could function as a link, however it is spelled. */
const URL_LIKE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S*/gi;
/** A bare `/c/...` path, which is the capability surface even without a scheme or host. */
const CAPABILITY_PATH_LIKE = /\/c\/\S*/gi;

/**
 * Remove anything link-shaped from text destined for a reminder body (D130).
 *
 * Deliberately aggressive: a false positive costs a Recipient a few words of context in a message
 * that tells them where to get the full version, and a false negative puts a live URL into an email
 * that promises none.
 */
export function redactUrls(value: string): string {
  return value
    .replace(URL_LIKE, '[link removed]')
    .replace(CAPABILITY_PATH_LIKE, '[link removed]')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Reduce persisted summary points to redacted, non-empty display lines. */
function displayLines(summaryLines: readonly string[]): string[] {
  return summaryLines.map((line) => redactUrls(line)).filter((line) => line.length > 0);
}

/**
 * The subject.
 *
 * Stable and recognizable, and deliberately not derived from Task content: a subject built from a
 * summary point would change when the summary changed, would need its own redaction pass, and would
 * put Task text into the one part of an email that mail clients display in notifications and
 * previews. It also carries no count and no ordinal — "reminder 3 of 14" is escalation language
 * dressed as information, and D106's ceiling is not the Recipient's business.
 */
export const REMINDER_EMAIL_SUBJECT = 'Reminder: an assigned task is still open' as const;

const AUTOMATED_NOTICE =
  'This is an automated reminder from your assistant. Nobody typed it, and you do not need to reply to it.';

const ORIGINAL_EMAIL_INSTRUCTION =
  'To open or update this task, please use the original assignment email you received. This reminder deliberately contains no link.';

const STOP_EXPLANATION =
  'Reminders stop on their own once the task is completed or dismissed, once its due date is removed, or once it is moved to waiting. You do not need to do anything else to stop them.';

function dueLine(input: ReminderEmailInput): string {
  return `Due: ${input.dueLocalDate} (${input.timeZone})`;
}

function buildPlainText(input: ReminderEmailInput): string {
  const lines: string[] = [AUTOMATED_NOTICE, '', 'Task summary:'];
  for (const line of displayLines(input.summaryLines)) {
    lines.push(`- ${line}`);
  }
  lines.push('', dueLine(input), '', ORIGINAL_EMAIL_INSTRUCTION, '', STOP_EXPLANATION);
  return lines.join('\n');
}

function buildHtml(input: ReminderEmailInput): string {
  const parts: string[] = ['<!DOCTYPE html>', '<html><body>'];
  parts.push(`<p>${escapeHtml(AUTOMATED_NOTICE)}</p>`);
  parts.push('<p><strong>Task summary</strong></p>');
  parts.push('<ul>');
  for (const line of displayLines(input.summaryLines)) {
    parts.push(`<li>${escapeHtml(line)}</li>`);
  }
  parts.push('</ul>');
  parts.push(`<p>${escapeHtml(dueLine(input))}</p>`);
  parts.push(`<p>${escapeHtml(ORIGINAL_EMAIL_INSTRUCTION)}</p>`);
  parts.push(`<p>${escapeHtml(STOP_EXPLANATION)}</p>`);
  // No anchor element anywhere in this builder. There is nothing for one to point at (D130).
  parts.push('</body></html>');
  return parts.join('\n');
}

export class ReminderEmailContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderEmailContentError';
  }
}

/**
 * Refuse to emit a reminder body that contains a link (D130).
 *
 * The last line of defence, and the only one that holds when the input is data rather than code.
 * Throwing is correct: the transport adapter maps a build failure to a non-retryable outcome and no
 * provider call happens, so a summary this cannot render safely produces a truthful failure rather
 * than an email that breaks a product decision.
 */
function assertLinkFree(body: string, alternative: 'text' | 'html'): void {
  if (/:\/\//.test(body) || /\/c\//.test(body) || /\bwww\./i.test(body)) {
    throw new ReminderEmailContentError(
      `Reminder ${alternative} body contains a link, which D130 forbids.`,
    );
  }
  if (/<a\s/i.test(body)) {
    throw new ReminderEmailContentError(
      `Reminder ${alternative} body contains an anchor, which D130 forbids.`,
    );
  }
}

/**
 * Build the reminder message.
 *
 * Returns an {@link OutboundMimeMessage} rather than an A7 `OutboundMessage`: a reminder has no
 * `HandoffDeliveryPath`, and claiming one so the shared MIME builder would accept it would write a
 * false value into A7's acceptance record. No `threadId`, no `In-Reply-To`, no `References`, no CC,
 * and no BCC — the message has exactly one recipient and starts no conversation.
 */
export function buildReminderEmail(input: ReminderEmailInput): OutboundMimeMessage {
  const textBody = buildPlainText(input);
  const htmlBody = buildHtml(input);
  assertLinkFree(textBody, 'text');
  assertLinkFree(htmlBody, 'html');

  return {
    from: input.from,
    to: input.to,
    subject: REMINDER_EMAIL_SUBJECT,
    textBody,
    htmlBody,
  };
}
