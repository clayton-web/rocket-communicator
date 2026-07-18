import { describe, expect, it } from 'vitest';
import { evaluateSuggestionRelevance } from '@/lib/suggestions/heuristic';

describe('evaluateSuggestionRelevance', () => {
  it('rejects missing usable content', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: null,
        snippet: null,
        fromAddress: 'person@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'MISSING_USABLE_CONTENT' });
  });

  it('rejects whitespace-only content', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: '   ',
        snippet: '\n\t',
        fromAddress: 'person@example.com',
        excerptContent: '  ',
      }),
    ).toEqual({ relevant: false, reasonCode: 'WHITESPACE_ONLY_CONTENT' });
  });

  it('rejects autoreply subjects', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Auto-Reply: Out of town',
        snippet: 'I am away',
        fromAddress: 'person@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'AUTOREPLY_SUBJECT' });
  });

  it('rejects out-of-office subjects at the subject prefix', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Out of Office: returning Monday',
        snippet: 'Thanks',
        fromAddress: 'person@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'OUT_OF_OFFICE_SUBJECT' });
  });

  it('does not skip noreply senders with actionable content (conservative)', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Invoice due Friday',
        snippet: 'Please pay the attached invoice by Friday',
        fromAddress: 'noreply@shop.example',
        excerptContent: null,
      }),
    ).toEqual({ relevant: true });
  });

  it('rejects mailer-daemon senders', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Delivery failure',
        snippet: 'could not deliver',
        fromAddress: 'mailer-daemon@mx.example',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'MAILER_DAEMON_SENDER' });
  });

  it('passes human discussion that mentions out of office mid-subject', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Planning around out of office coverage',
        snippet: 'Can you cover Tuesday?',
        fromAddress: 'colleague@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: true });
  });

  it('rejects delivery status subjects', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Delivery Status Notification (Failure)',
        snippet: 'undeliverable',
        fromAddress: 'postoffice@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'DELIVERY_STATUS_SUBJECT' });
  });

  it('rejects calendar notification subjects', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Accepted: Team sync',
        snippet: 'accepted the invitation',
        fromAddress: 'person@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'CALENDAR_NOTIFICATION_SUBJECT' });
  });

  it('rejects unsubscribe-only bodies', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: null,
        snippet: 'Unsubscribe',
        fromAddress: 'person@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: false, reasonCode: 'UNSUBSCRIBE_ONLY_BODY' });
  });

  it('passes short uncertain human messages (conservative)', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Hi',
        snippet: 'Call me',
        fromAddress: 'friend@example.com',
        excerptContent: null,
      }),
    ).toEqual({ relevant: true });
  });

  it('passes substantive human mail even mentioning unsubscribe', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: 'Project update',
        snippet: 'Please review the attached plan. Unsubscribe links are at the bottom.',
        fromAddress: 'colleague@example.com',
        excerptContent: 'We need a decision by Friday on the budget.',
      }),
    ).toEqual({ relevant: true });
  });

  it('passes when only excerpt has content', () => {
    expect(
      evaluateSuggestionRelevance({
        subject: null,
        snippet: null,
        fromAddress: 'person@example.com',
        excerptContent: 'Can you approve the vendor quote?',
      }),
    ).toEqual({ relevant: true });
  });
});
