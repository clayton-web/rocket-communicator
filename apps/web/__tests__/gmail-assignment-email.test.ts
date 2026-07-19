// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAssignmentEmail,
  type AssignmentEmailInput,
} from '@/lib/gmail/outbound/assignment-email';
import { buildMimeMessage, MimeConstructionError, toBase64Url } from '@/lib/gmail/transport/mime';

const FAKE_CAPABILITY_URL = 'https://app.example.com/c/FAKE-TOKEN-abc123';

function baseInput(overrides: Partial<AssignmentEmailInput> = {}): AssignmentEmailInput {
  return {
    from: { email: 'owner@example.com', name: 'Owner Biz' },
    to: { email: 'recipient@example.com', name: 'Pat Recipient' },
    ownerContext: 'Owner Biz has an assignment for you.',
    taskTitle: 'Prepare Q3 report',
    taskSummary: 'Please compile the Q3 numbers and share a draft.',
    dueOrUrgency: 'Due Friday',
    recipientInstructions: 'Reply if you have questions.',
    acknowledgementNote: 'You can acknowledge from the link.',
    capabilityUrl: FAKE_CAPABILITY_URL,
    ...overrides,
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('A7.4 assignment_email builder', () => {
  it('produces plain-text and HTML alternatives', () => {
    const msg = buildAssignmentEmail(baseInput());
    expect(msg.textBody.length).toBeGreaterThan(0);
    expect(msg.htmlBody).toBeDefined();
    expect(msg.deliveryPath).toBe('assignment_email');
  });

  it('targets the correct recipient', () => {
    const msg = buildAssignmentEmail(baseInput());
    expect(msg.to.email).toBe('recipient@example.com');
  });

  it('includes the capability link exactly once per alternative', () => {
    const msg = buildAssignmentEmail(baseInput());
    expect(count(msg.textBody, FAKE_CAPABILITY_URL)).toBe(1);
    expect(count(msg.htmlBody as string, FAKE_CAPABILITY_URL)).toBe(1);
  });

  it('does not leak internal ids or source excerpts', () => {
    const msg = buildAssignmentEmail(baseInput());
    const combined = `${msg.textBody}\n${msg.htmlBody}`;
    expect(combined).not.toMatch(/org_[0-9a-f]/i);
    expect(combined).not.toMatch(/task_[0-9a-f]/i);
    expect(combined).not.toContain('assignmentId');
  });

  it('is fully constructible as MIME and base64url-encodable', () => {
    const msg = buildAssignmentEmail(baseInput());
    const raw = buildMimeMessage(msg, {
      boundaryFactory: () => 'B',
      now: new Date('2026-07-18T00:00:00Z'),
      messageIdFactory: () => 'id@example.com',
    });
    const encoded = toBase64Url(raw);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('rejects header injection when a malicious recipient is supplied downstream', () => {
    const msg = buildAssignmentEmail(baseInput({ to: { email: 'a@b.com\r\nBcc: evil@x.com' } }));
    expect(() => buildMimeMessage(msg)).toThrow(MimeConstructionError);
  });

  it('supports unicode subject/display names via MIME encoding', () => {
    const msg = buildAssignmentEmail(
      baseInput({ taskTitle: 'Tâche café', to: { email: 'r@example.com', name: 'Niño' } }),
    );
    const raw = buildMimeMessage(msg);
    expect(raw).toContain('=?UTF-8?B?');
  });

  it('omits optional sections when not supplied but still includes the link once', () => {
    const msg = buildAssignmentEmail(
      baseInput({
        dueOrUrgency: undefined,
        recipientInstructions: undefined,
        acknowledgementNote: undefined,
      }),
    );
    expect(count(msg.textBody, FAKE_CAPABILITY_URL)).toBe(1);
    expect(msg.textBody).not.toContain('Due / urgency');
  });
});
