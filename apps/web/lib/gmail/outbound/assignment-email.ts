import 'server-only';
import type { OutboundAddress, OutboundMessage } from '../transport/outbound-types';
import { escapeHtml, escapeHtmlAttribute } from './text-utils';

/**
 * A7.4 assignment_email builder.
 *
 * Composes a NEW message (not a disguised forward) containing only information authorized for
 * Recipient handoff: Owner/business context, a concise Task summary, optional due/urgency,
 * Recipient instructions, the acknowledgement context (D089), and the already-issued capability
 * link. It NEVER includes source excerpts beyond the authorized summary, internal database IDs,
 * raw model prompt/output, or hidden Gmail metadata.
 *
 * The capability URL is received fully-formed. This builder does not generate, query, activate, or
 * log it — it is placed exactly once per alternative (plain text as the raw URL; HTML as an anchor
 * href) and nowhere else.
 */

export interface AssignmentEmailInput {
  /** Owner Gmail identity (sender). */
  from: OutboundAddress;
  /** Recipient address (+ optional display name). */
  to: OutboundAddress;
  /** Owner identity / business context shown in the body. */
  ownerContext: string;
  /** Short Task title used in the subject + body heading. */
  taskTitle: string;
  /** Concise Task summary authorized for handoff (no source excerpt beyond this). */
  taskSummary: string;
  /** Optional due date / urgency, only rendered when supplied. */
  dueOrUrgency?: string;
  /** Optional Recipient instructions. */
  recipientInstructions?: string;
  /** Optional D089 acknowledgement / context note. */
  acknowledgementNote?: string;
  /** Fully-formed, already-issued capability URL. Included once per alternative. */
  capabilityUrl: string;
}

function buildPlainText(input: AssignmentEmailInput): string {
  const lines: string[] = [];
  lines.push(input.ownerContext.trim());
  lines.push('');
  lines.push(`Task: ${input.taskTitle.trim()}`);
  lines.push('');
  lines.push(input.taskSummary.trim());
  if (input.dueOrUrgency?.trim()) {
    lines.push('');
    lines.push(`Due / urgency: ${input.dueOrUrgency.trim()}`);
  }
  if (input.recipientInstructions?.trim()) {
    lines.push('');
    lines.push(input.recipientInstructions.trim());
  }
  lines.push('');
  lines.push('Open your assignment:');
  // Capability URL appears exactly once in the plain-text alternative.
  lines.push(input.capabilityUrl);
  if (input.acknowledgementNote?.trim()) {
    lines.push('');
    lines.push(input.acknowledgementNote.trim());
  }
  return lines.join('\n');
}

function buildHtml(input: AssignmentEmailInput): string {
  const parts: string[] = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html><body>');
  parts.push(`<p>${escapeHtml(input.ownerContext.trim())}</p>`);
  parts.push(`<h2>${escapeHtml(input.taskTitle.trim())}</h2>`);
  parts.push(`<p>${escapeHtml(input.taskSummary.trim())}</p>`);
  if (input.dueOrUrgency?.trim()) {
    parts.push(`<p><strong>Due / urgency:</strong> ${escapeHtml(input.dueOrUrgency.trim())}</p>`);
  }
  if (input.recipientInstructions?.trim()) {
    parts.push(`<p>${escapeHtml(input.recipientInstructions.trim())}</p>`);
  }
  // Capability URL appears exactly once in the HTML alternative (as the anchor href).
  parts.push(
    `<p><a href="${escapeHtmlAttribute(input.capabilityUrl)}">Open your assignment</a></p>`,
  );
  if (input.acknowledgementNote?.trim()) {
    parts.push(`<p>${escapeHtml(input.acknowledgementNote.trim())}</p>`);
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

/** Build a normalized assignment_email OutboundMessage (plain-text + HTML alternatives). */
export function buildAssignmentEmail(input: AssignmentEmailInput): OutboundMessage {
  const subject = input.taskTitle.trim() ? `Assignment: ${input.taskTitle.trim()}` : 'Assignment';
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody: buildPlainText(input),
    htmlBody: buildHtml(input),
    deliveryPath: 'assignment_email',
  };
}
