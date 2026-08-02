import { describe, expect, it } from 'vitest';
import { ROCKET_GENERATED_HEADER_NAME } from '@aicaa/domain';
import {
  buildOwnerNotificationEmail,
  formatOccurredAt,
  OwnerNotificationEmailContentError,
  ownerNotificationSubject,
  assertSafeOwnerLink,
  type OwnerNotificationEmailInput,
  type OwnerNotificationEventType,
} from '@/lib/gmail/outbound/owner-notification-email';
import { buildMimeMessage } from '@/lib/gmail/transport/mime';

/**
 * A8.5c Owner Event Notification content (D133, D134, D136).
 *
 * These read the **serialized** message as well as the model, because two of the properties under
 * test only exist on the wire: the D136 marker is a header rather than a field, and "no capability
 * token reaches the Owner's inbox" is a claim about bytes. A body that satisfies a rule in plain text
 * and breaks it in HTML has broken it, so both alternatives are asserted throughout.
 */

const MAILBOX = { email: 'owner@example.com', name: 'Owner' } as const;

const BASE: OwnerNotificationEmailInput = {
  from: MAILBOX,
  to: MAILBOX,
  eventType: 'task_completed_by_recipient',
  actorKind: 'capability',
  occurredAt: '2026-08-20T18:04:05.000Z',
  summaryLines: ['Confirm the venue booking', 'Caterer needs a final headcount'],
  ownerLink: 'https://app.example.com/tasks/task_123',
};

function bodies(input: OwnerNotificationEmailInput = BASE): {
  text: string;
  html: string;
  mime: string;
  subject: string;
} {
  const message = buildOwnerNotificationEmail(input);
  return {
    text: message.textBody,
    html: message.htmlBody ?? '',
    subject: message.subject,
    mime: buildMimeMessage(message, {
      now: new Date('2026-08-20T18:05:00.000Z'),
      boundaryFactory: () => 'BOUNDARY',
      messageIdFactory: () => 'fixed@example.com',
    }),
  };
}

describe('A8.5c Owner notification email: required content', () => {
  const { text, html } = bodies();

  const REQUIRED = [
    { what: 'an automated-notification statement', pattern: /automated notification/i },
    { what: 'the reason no reply is needed', pattern: /do not need to reply/i },
    { what: 'the canonical event meaning', pattern: /marked it complete/i },
    { what: 'the first summary point', pattern: /Confirm the venue booking/ },
    { what: 'the second summary point', pattern: /Caterer needs a final headcount/ },
    { what: 'the event occurrence date', pattern: /2026-08-20/ },
    { what: 'the event occurrence time', pattern: /18:04:05 UTC/ },
    {
      what: 'the authenticated Owner link',
      pattern: /https:\/\/app\.example\.com\/tasks\/task_123/,
    },
    { what: 'the no-quoting explanation', pattern: /does not quote any message text/i },
  ] as const;

  for (const { what, pattern } of REQUIRED) {
    it(`states ${what} in the text alternative`, () => {
      expect(text).toMatch(pattern);
    });
    it(`states ${what} in the HTML alternative`, () => {
      expect(html).toMatch(pattern);
    });
  }

  it('uses a deterministic subject that names the event and no Task content', () => {
    const { subject } = bodies();
    expect(subject).toBe('Task update: marked complete by the recipient');
    expect(subject).toBe(ownerNotificationSubject('task_completed_by_recipient'));
    expect(subject).not.toMatch(/venue|headcount/i);
    // Stable across builds: nothing in it is derived from time, summary, or attempt number.
    expect(bodies().subject).toBe(subject);
  });
});

describe('A8.5c Owner notification email: truthful actor attribution', () => {
  it('says the recipient completed the task, and never the Owner or Rocket', () => {
    const { text, html } = bodies();
    for (const body of [text, html]) {
      expect(body).toMatch(/Who acted: the recipient, using the link you sent them\./);
      expect(body).not.toMatch(/you completed/i);
      expect(body).not.toMatch(/rocket completed/i);
      expect(body).not.toMatch(/the owner completed/i);
      expect(body).not.toMatch(/your assistant completed/i);
    }
  });

  it('distinguishes system and Owner action from Recipient action', () => {
    const system = bodies({ ...BASE, actorKind: 'system' });
    expect(system.text).toMatch(/Who acted: your assistant, automatically\./);
    expect(system.text).not.toMatch(/the recipient, using the link/);

    const owner = bodies({ ...BASE, actorKind: 'owner' });
    expect(owner.text).toMatch(/Who acted: you, from your own account\./);
    expect(owner.text).not.toMatch(/the recipient, using the link/);
  });

  /**
   * The attribution line carries the actor *kind* and nothing finer. A Recipient's name or address
   * in an Owner notification would be a new disclosure channel and is not needed to say who acted.
   */
  it('names no Recipient identity in either alternative', () => {
    const { text, html } = bodies();
    for (const body of [text, html]) {
      expect(body).not.toMatch(/recipient@/i);
      expect(body).not.toMatch(/@example\.com/);
    }
  });
});

describe('A8.5c Owner notification email: prohibited content', () => {
  /**
   * The renderer has no parameter for any of these, so the assertion is that no parameter it *does*
   * have can produce them. Summary lines are the one caller-controlled input, so they carry the
   * payloads.
   */
  const HOSTILE: OwnerNotificationEmailInput = {
    ...BASE,
    summaryLines: [
      'Ordinary point that must survive',
      // Whatever a summary point contains, none of it may reach the wire as a link.
      'Open [link removed] to pay',
    ],
  };

  it('carries no capability token, /c/ path, or capability URL', () => {
    const { text, html, mime } = bodies(HOSTILE);
    for (const body of [text, html, mime]) {
      expect(body).not.toMatch(/\/c\//);
      expect(body).not.toMatch(/capability/i);
      expect(body).not.toMatch(/token/i);
    }
  });

  it('refuses a body carrying a capability path rather than emitting it', () => {
    expect(() =>
      buildOwnerNotificationEmail({
        ...BASE,
        summaryLines: ['Open /c/abc123 to approve'],
      }),
    ).toThrow(OwnerNotificationEmailContentError);
  });

  /**
   * A summary point can legitimately contain a URL, because it was derived from a real message. The
   * caller redacts, and this is the assertion that catches a caller who did not: exactly one URL may
   * appear in the body, and it must be the Owner link this renderer chose.
   */
  it('refuses an arbitrary URL arriving through a summary point', () => {
    expect(() =>
      buildOwnerNotificationEmail({
        ...BASE,
        summaryLines: ['Pay the invoice at https://vendor.example/inv/993'],
      }),
    ).toThrow(/unexpected URL/);
  });

  it('carries no provider data, exception text, or tracking content', () => {
    const { mime } = bodies();
    expect(mime).not.toMatch(/googleapis/i);
    expect(mime).not.toMatch(/access_token|refresh_token|Bearer /);
    expect(mime).not.toMatch(/stack|Error:/);
    expect(mime).not.toMatch(/<img/i);
    expect(mime).not.toMatch(/1x1|pixel|utm_/i);
  });

  it('escapes HTML rather than letting summary text become markup', () => {
    const { html } = bodies({
      ...BASE,
      summaryLines: ['<script>alert(1)</script> & "quoted"'],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });
});

describe('A8.5c Owner notification email: the Owner link', () => {
  it('is omitted entirely when the event has no safe destination', () => {
    const { text, html } = bodies({ ...BASE, ownerLink: undefined });
    for (const body of [text, html]) {
      expect(body).not.toMatch(/Open in your assistant/);
      expect(body).not.toMatch(/:\/\//);
    }
  });

  it('renders href and visible text as the same URL, so the two cannot disagree', () => {
    const { html } = bodies();
    expect(html).toContain(
      '<a href="https://app.example.com/tasks/task_123">https://app.example.com/tasks/task_123</a>',
    );
  });

  const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['a capability surface', 'https://app.example.com/c/tok_abc'],
    ['plain http on a public host', 'http://app.example.com/tasks/task_123'],
    ['embedded credentials', 'https://user:pw@app.example.com/tasks/task_123'],
    ['a query string that could carry a token', 'https://app.example.com/tasks/t?token=abc'],
    ['a fragment that could carry a token', 'https://app.example.com/tasks/t#tok'],
    ['a non-absolute reference', '/tasks/task_123'],
    ['a javascript scheme', 'javascript:alert(1)'],
  ];

  for (const [what, link] of REFUSED) {
    it(`refuses ${what}`, () => {
      expect(() => assertSafeOwnerLink(link)).toThrow(OwnerNotificationEmailContentError);
      expect(() => buildOwnerNotificationEmail({ ...BASE, ownerLink: link })).toThrow(
        OwnerNotificationEmailContentError,
      );
    });
  }

  it('permits loopback http, because local development has no certificate', () => {
    expect(assertSafeOwnerLink('http://localhost:3000/tasks/task_123')).toBe(
      'http://localhost:3000/tasks/task_123',
    );
  });
});

describe('A8.5c Owner notification email: occurrence time', () => {
  it('renders the instant in UTC, explicitly labelled', () => {
    expect(formatOccurredAt('2026-08-20T18:04:05.000Z')).toBe('2026-08-20 18:04:05 UTC');
  });

  it('fails closed on an unparseable instant rather than rendering an invalid date', () => {
    expect(() => formatOccurredAt('not-a-date')).toThrow(OwnerNotificationEmailContentError);
    expect(() => buildOwnerNotificationEmail({ ...BASE, occurredAt: '' })).toThrow(
      OwnerNotificationEmailContentError,
    );
  });
});

describe('A8.5c Owner notification email: the whole ratified taxonomy renders', () => {
  const EVENTS: readonly OwnerNotificationEventType[] = [
    'task_completed_by_recipient',
    'task_clarification_requested',
    'task_returned_to_owner',
    'handoff_delivery_failed',
    'gmail_disconnected',
    'capability_expired',
    'reminder_schedule_stopped_ceiling_reached',
    'reminder_schedule_stopped_permanent_failure',
    'reminder_schedule_stopped_repeated_ambiguous',
    'reminder_no_active_assignment',
  ];

  it('covers exactly the ten ratified events, with distinct subjects', () => {
    const subjects = EVENTS.map((event) => ownerNotificationSubject(event));
    expect(subjects).toHaveLength(10);
    expect(new Set(subjects).size).toBe(10);
    expect(subjects.every((subject) => subject.length > 0)).toBe(true);
  });

  for (const eventType of EVENTS) {
    it(`renders ${eventType} with both alternatives and the marker`, () => {
      const { text, html, mime } = bodies({ ...BASE, eventType });
      expect(text.length).toBeGreaterThan(0);
      expect(html).toContain('</body></html>');
      expect(mime).toContain(`${ROCKET_GENERATED_HEADER_NAME}: owner-event-notification\r\n`);
    });
  }

  /**
   * The renderer is reachable from a database row, and a row can hold an enum value a deployed build
   * has never heard of. That is the case this covers — the type system cannot.
   */
  it('fails closed on an event type it has no ratified copy for', () => {
    expect(() =>
      buildOwnerNotificationEmail({
        ...BASE,
        eventType: 'task.invented_later' as unknown as OwnerNotificationEventType,
      }),
    ).toThrow(OwnerNotificationEmailContentError);
  });
});

describe('A8.5c Owner notification email: serialized MIME', () => {
  const { mime } = bodies();
  const header = mime.split('\r\n\r\n')[0];

  it('carries the D136 marker exactly once, with the fixed name and value', () => {
    const occurrences = mime.split(`${ROCKET_GENERATED_HEADER_NAME}:`).length - 1;
    expect(occurrences).toBe(1);
    expect(header).toContain(`${ROCKET_GENERATED_HEADER_NAME}: owner-event-notification`);
  });

  it('emits the marker unfolded and unencoded, so an ingestion check can match it', () => {
    // Short and ASCII, so neither RFC 2047 nor line folding applies. If either ever did, the
    // ingestion side would stop recognizing Rocket's own mail and the self-ingestion loop returns.
    expect(mime).toContain(`\r\n${ROCKET_GENERATED_HEADER_NAME}: owner-event-notification\r\n`);
    expect(mime).not.toContain('=?UTF-8?B?');
  });

  it('is a send-to-self message: From and To are the same connected mailbox', () => {
    expect(header).toContain('From: Owner <owner@example.com>');
    expect(header).toContain('To: Owner <owner@example.com>');
  });

  it('starts no conversation and adds no other custom header', () => {
    expect(header).not.toMatch(/\r\nIn-Reply-To:/i);
    expect(header).not.toMatch(/\r\nReferences:/i);
    expect(header).not.toMatch(/\r\nCc:/i);
    expect(header).not.toMatch(/\r\nBcc:/i);
    // The D136 marker is the only `X-` header this message may carry.
    const xHeaders = header.match(/\r\nX-[\w-]+:/g) ?? [];
    expect(xHeaders).toEqual([`\r\n${ROCKET_GENERATED_HEADER_NAME}:`]);
  });

  it('offers both alternatives as multipart/alternative', () => {
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY"');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
  });

  it('claims no HandoffDeliveryPath', () => {
    expect(buildOwnerNotificationEmail(BASE)).not.toHaveProperty('deliveryPath');
  });
});
