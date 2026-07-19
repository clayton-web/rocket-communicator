import 'server-only';

/**
 * A7.4 outbound text helpers shared by the assignment-email and gmail-forward builders.
 * All builder-supplied text is treated as untrusted for HTML output and escaped.
 */

/** Escape text for safe inclusion in HTML bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a URL for an HTML attribute context (href/src). */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

/**
 * Normalize a subject into a single "Fwd: " prefix, collapsing repeated/nested forward markers
 * (Fwd:, Fw:, FWD:) and localized-style duplicates so subjects do not inflate over re-forwards.
 */
export function normalizeForwardSubject(subject: string | null | undefined): string {
  const base = (subject ?? '').trim();
  const stripped = base.replace(/^(?:\s*(?:fwd?|fw)\s*:\s*)+/i, '').trim();
  if (!stripped) {
    return 'Fwd:';
  }
  return `Fwd: ${stripped}`;
}

/** Convert plain text to minimal safe HTML paragraphs (escaping + line breaks). */
export function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br />\n');
}
