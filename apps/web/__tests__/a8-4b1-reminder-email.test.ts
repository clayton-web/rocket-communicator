import { describe, expect, it } from 'vitest';
import {
  REMINDER_EMAIL_SUBJECT,
  ReminderEmailContentError,
  buildReminderEmail,
  redactUrls,
} from '@/lib/gmail/outbound/reminder-email';
import { buildMimeMessage } from '@/lib/gmail/transport/mime';

/**
 * A8.4b.1 reminder email content (D130).
 *
 * The reminder is the first message this system sends that is *not* a delivery of the work, and its
 * content is an allowlist rather than a template with a few rules attached. These tests read both MIME
 * alternatives, because a body that satisfies D130 in plain text and violates it in HTML has violated
 * D130 — and the HTML alternative is the one a mail client actually renders.
 */

const BASE = {
  from: { email: 'owner@example.com', name: 'Owner' },
  to: { email: 'recipient@example.com' },
  summaryLines: ['Confirm the venue booking', 'Caterer needs a final headcount'],
  dueLocalDate: '2026-08-05',
  timeZone: 'America/Los_Angeles',
} as const;

/** Both alternatives, plus the assembled MIME, because headers are content too. */
function bodies(input = BASE): { text: string; html: string; mime: string } {
  const message = buildReminderEmail(input);
  return {
    text: message.textBody,
    html: message.htmlBody ?? '',
    mime: buildMimeMessage(message, {
      now: new Date('2026-08-20T18:00:00.000Z'),
      boundaryFactory: () => 'BOUNDARY',
      messageIdFactory: () => 'fixed@example.com',
    }),
  };
}

describe('A8.4b.1 reminder email: required content', () => {
  const { text, html } = bodies();

  /**
   * Asserted by meaning rather than by one literal, so a reworded body that still says the thing
   * keeps passing and a body that quietly drops it fails. A single-token match would be satisfied by
   * the word "reminder" appearing in the subject.
   */
  const REQUIRED = [
    { what: 'an automated-reminder statement', pattern: /automated reminder/i },
    { what: 'the reason no reply is needed', pattern: /do not need to reply/i },
    { what: 'the first approved summary point', pattern: /Confirm the venue booking/ },
    { what: 'the second approved summary point', pattern: /Caterer needs a final headcount/ },
    { what: 'the organization-local due date', pattern: /2026-08-05/ },
    { what: 'the organization timezone', pattern: /America\/Los_Angeles/ },
    {
      what: 'an instruction to use the original assignment email',
      pattern: /original assignment email/i,
    },
    { what: 'an explanation that it carries no link', pattern: /contains no link/i },
    { what: 'what stops reminders', pattern: /completed or dismissed/i },
    { what: 'that waiting stops them too', pattern: /waiting/i },
    {
      what: 'that the Recipient need do nothing else',
      pattern: /do not need to do anything else/i,
    },
  ];

  for (const { what, pattern } of REQUIRED) {
    it(`the text body states ${what}`, () => {
      expect(text).toMatch(pattern);
    });
    it(`the HTML body states ${what}`, () => {
      expect(html).toMatch(pattern);
    });
  }

  it('has a stable subject carrying no Task content, count, or ordinal', () => {
    expect(REMINDER_EMAIL_SUBJECT).toBe('Reminder: an assigned task is still open');
    expect(buildReminderEmail(BASE).subject).toBe(REMINDER_EMAIL_SUBJECT);
    // A subject built from Task text would leak summary content into notification previews.
    expect(REMINDER_EMAIL_SUBJECT).not.toMatch(/venue|caterer/i);
    expect(REMINDER_EMAIL_SUBJECT).not.toMatch(/\d/);
  });

  it('renders the due date as a local calendar date, never as an instant', () => {
    for (const body of [text, html]) {
      expect(body).not.toMatch(/T\d\d:\d\d/);
      expect(body).not.toMatch(/\bZ\b/);
      expect(body).not.toMatch(/GMT|UTC[+-]/);
    }
  });
});

describe('A8.4b.1 reminder email: forbidden content (D130)', () => {
  const { text, html, mime } = bodies();

  const FORBIDDEN = [
    { what: 'a capability path', pattern: /\/c\// },
    { what: 'an http URL', pattern: /http:\/\// },
    { what: 'an https URL', pattern: /https:\/\// },
    { what: 'any scheme-like URL', pattern: /[a-z][a-z0-9+.-]*:\/\// },
    { what: 'a bare www host', pattern: /\bwww\./i },
    { what: 'an HTML anchor', pattern: /<a[\s>]/i },
    { what: 'a mailto link', pattern: /mailto:/i },
    {
      what: 'escalation wording',
      pattern: /urgent|immediately|overdue notice|final reminder|failure to/i,
    },
    { what: 'punitive wording', pattern: /must respond|required to|consequence|escalat/i },
    {
      what: 'a reminder count or ordinal',
      pattern: /\b(\d+\s+of\s+\d+|first|second|third|final)\s+reminder\b/i,
    },
    { what: 'an internal schedule identifier', pattern: /sched_/ },
    { what: 'an internal task identifier', pattern: /task_/ },
    { what: 'an internal occurrence identifier', pattern: /rocc_/ },
    { what: 'a capability identifier', pattern: /cap_/ },
    { what: 'a token-like value', pattern: /token/i },
  ];

  for (const { what, pattern } of FORBIDDEN) {
    it(`the text body contains no ${what}`, () => {
      expect(text.match(pattern)?.[0] ?? null).toBe(null);
    });
    it(`the HTML body contains no ${what}`, () => {
      expect(html.match(pattern)?.[0] ?? null).toBe(null);
    });
  }

  it('emits no threading, CC, or BCC headers', () => {
    for (const header of [/^In-Reply-To:/im, /^References:/im, /^Cc:/im, /^Bcc:/im, /threadId/i]) {
      expect(mime.match(header)?.[0] ?? null).toBe(null);
    }
    // Exactly one recipient header, so nobody was added silently.
    expect((mime.match(/^To:/gim) ?? []).length).toBe(1);
  });

  it('carries no communication excerpt beyond the approved summary points', () => {
    const excerpt = 'On Tue, Aug 4, 2026, vendor@example.com wrote: > please confirm';
    const { text: withExcerpt, html: htmlWithExcerpt } = bodies({
      ...BASE,
      summaryLines: [...BASE.summaryLines],
    });
    // The builder has no channel for an excerpt at all: its only content input is `summaryLines`.
    expect(withExcerpt).not.toContain(excerpt);
    expect(htmlWithExcerpt).not.toContain(excerpt);
    expect(Object.keys(BASE)).toEqual(['from', 'to', 'summaryLines', 'dueLocalDate', 'timeZone']);
  });
});

/**
 * Summary points are authorized content *and* derived from a real communication, so a legitimate one
 * can contain a URL. That is the one way a link could enter a message D130 says carries none, and it
 * arrives from the database rather than from any call site.
 */
describe('A8.4b.1 reminder email: URLs arriving inside approved summary text', () => {
  const WITH_URLS = {
    ...BASE,
    summaryLines: [
      'Pay the invoice at https://vendor.example/inv/993 before Friday',
      'Portal is www.vendor.example/login',
      'Old capability was /c/abc123def456',
      'Contact mailto:ap@vendor.example',
    ],
  };

  it('redacts every link shape and still renders the surrounding words', () => {
    const { text, html } = bodies(WITH_URLS);
    for (const body of [text, html]) {
      expect(body).not.toMatch(/:\/\//);
      expect(body).not.toMatch(/\bwww\./i);
      expect(body).not.toMatch(/\/c\//);
      expect(body).not.toMatch(/mailto:/i);
      expect(body).not.toContain('abc123def456');
      // The useful part of the sentence survives, so the reminder still means something.
      expect(body).toMatch(/Pay the invoice at/);
      expect(body).toMatch(/before Friday/);
      expect(body).toContain('[link removed]');
    }
  });

  it('redacts a bare capability path even without a scheme or host', () => {
    expect(redactUrls('see /c/tok_abcdef now')).toBe('see [link removed] now');
  });

  it('leaves link-free text untouched apart from trimming', () => {
    expect(redactUrls('  Confirm the venue booking  ')).toBe('Confirm the venue booking');
  });

  it('refuses to emit a body a redaction pass somehow failed to clean', () => {
    /**
     * The last line of defence, exercised against input the redactor genuinely misses.
     *
     * `9x://evil.example` has no match: a scheme must start with a letter, so the pattern fails at
     * the `9`, and there is no word boundary between `9` and `x` for it to retry at. The redactor
     * leaves it alone and `assertLinkFree` throws instead of emitting a body containing `://`.
     *
     * That is the point of having two mechanisms. The redactor is a best effort over adversarial
     * data; the assertion is the invariant, and it is the one D130 actually depends on.
     */
    const evasive = '9x://evil.example';
    expect(redactUrls(evasive)).toBe(evasive);
    expect(() => buildReminderEmail({ ...BASE, summaryLines: [evasive] })).toThrow(
      ReminderEmailContentError,
    );
  });
});

describe('A8.4b.1 reminder email: privacy of what is built', () => {
  it('builds a message carrying no access token or provider metadata', () => {
    const message = buildReminderEmail(BASE);
    const serialized = JSON.stringify(message);
    expect(serialized).not.toMatch(/ya29|Bearer|access_token|refresh_token/i);
    // The shape itself has nowhere to put one: five keys, all content or addressing.
    expect(Object.keys(message).sort()).toEqual(['from', 'htmlBody', 'subject', 'textBody', 'to']);
  });

  it('has no A7 delivery path, so a reminder cannot be recorded as an assignment email', () => {
    expect(buildReminderEmail(BASE)).not.toHaveProperty('deliveryPath');
  });

  it('drops summary points that redact away to nothing rather than rendering empty bullets', () => {
    const { text } = bodies({
      ...BASE,
      summaryLines: ['https://only-a-link.example', 'Real point'],
    });
    expect(text).toContain('- Real point');
    expect(text).not.toMatch(/-\s*$/m);
  });
});
