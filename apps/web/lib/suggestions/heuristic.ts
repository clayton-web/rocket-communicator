/**
 * Deterministic relevance heuristic (D085).
 * Conservative: only high-confidence automated/irrelevant patterns are rejected.
 * Short or uncertain human communications pass through for AI extraction.
 * No network calls. Does not invent suggestions.
 */

export type HeuristicReasonCode =
  | 'MISSING_USABLE_CONTENT'
  | 'WHITESPACE_ONLY_CONTENT'
  | 'AUTOREPLY_SUBJECT'
  | 'OUT_OF_OFFICE_SUBJECT'
  | 'MAILER_DAEMON_SENDER'
  | 'DELIVERY_STATUS_SUBJECT'
  | 'CALENDAR_NOTIFICATION_SUBJECT'
  | 'UNSUBSCRIBE_ONLY_BODY';

export type HeuristicDecision =
  { relevant: true } | { relevant: false; reasonCode: HeuristicReasonCode };

export interface HeuristicInput {
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  /** Temporary excerpt body when present and not purged; otherwise null/empty. */
  excerptContent: string | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function combinedBody(input: HeuristicInput): string {
  return normalize([input.subject, input.snippet, input.excerptContent].filter(Boolean).join(' '));
}

const AUTOREPLY_SUBJECT =
  /^(re:\s*)?(auto[- ]?reply|automatic reply|automatische antwort|réponse automatique)\b/i;
/** Subject-prefix only — avoid matching "OOO" / "out of office" mid-thread discussion titles. */
const OOO_SUBJECT = /^(re:\s*)?(out of office|ooo)\b([:\s-].*)?$/i;
const DELIVERY_SUBJECT =
  /^(re:\s*)?(delivery status notification|undeliverable|mail delivery (sub)?system|returned mail|failure notice)\b/i;
const CALENDAR_SUBJECT = /^(accepted|declined|tentative|updated|canceled|cancelled):\s*.+/i;
const MAILER_DAEMON_LOCAL = /^(mailer[-_]?daemon|postmaster)(\+.*)?$/i;
const UNSUBSCRIBE_ONLY =
  /^(unsubscribe|opt[- ]?out|manage (your )?preferences|view (this|in) browser|email preferences)\.?$/i;

function localPart(email: string): string {
  const at = email.indexOf('@');
  return (at >= 0 ? email.slice(0, at) : email).trim().toLowerCase();
}

/**
 * Conservative relevance gate. Returns irrelevant only for stable high-confidence patterns.
 *
 * Note: `noreply@` / `no-reply@` alone do **not** skip — invoices and actionable notices often
 * use those locals. Only mailer-daemon/postmaster senders are rejected by address.
 */
export function evaluateSuggestionRelevance(input: HeuristicInput): HeuristicDecision {
  const subject = normalize(input.subject);
  const usable = combinedBody(input);
  const hadRawContent = [input.subject, input.snippet, input.excerptContent].some(
    (value) => typeof value === 'string' && value.length > 0,
  );

  if (usable.length === 0) {
    return {
      relevant: false,
      reasonCode: hadRawContent ? 'WHITESPACE_ONLY_CONTENT' : 'MISSING_USABLE_CONTENT',
    };
  }

  const from = normalize(input.fromAddress).toLowerCase();
  const local = localPart(from);

  if (MAILER_DAEMON_LOCAL.test(local)) {
    return { relevant: false, reasonCode: 'MAILER_DAEMON_SENDER' };
  }

  if (subject.length > 0) {
    if (AUTOREPLY_SUBJECT.test(subject)) {
      return { relevant: false, reasonCode: 'AUTOREPLY_SUBJECT' };
    }
    if (OOO_SUBJECT.test(subject)) {
      return { relevant: false, reasonCode: 'OUT_OF_OFFICE_SUBJECT' };
    }
    if (DELIVERY_SUBJECT.test(subject)) {
      return { relevant: false, reasonCode: 'DELIVERY_STATUS_SUBJECT' };
    }
    if (CALENDAR_SUBJECT.test(subject)) {
      return { relevant: false, reasonCode: 'CALENDAR_NOTIFICATION_SUBJECT' };
    }
  }

  // Unsubscribe-only: only when the entire usable body is a short unsubscribe phrase.
  // Do not reject short human messages that merely mention unsubscribe in passing.
  if (usable.length <= 64 && UNSUBSCRIBE_ONLY.test(usable)) {
    return { relevant: false, reasonCode: 'UNSUBSCRIBE_ONLY_BODY' };
  }

  return { relevant: true };
}
