import { describe, expect, it } from 'vitest';
import {
  DomainError,
  MAX_GMAIL_EXCERPT_BYTES,
  asCommunicationEventId,
  asTemporaryCommunicationExcerptId,
  measureExcerptByteLength,
  type ParsedGmailMessageFixture,
} from '@aicaa/domain';
import { buildGmailHistoryPageExcerptIntents } from '../src/transactions/gmail-history-page-excerpt-intent.js';

const now = '2026-08-17T00:00:00.000Z';
const purgeAt = '2026-08-24T00:00:00.000Z';
const laterPurgeAt = '2026-08-31T00:00:00.000Z';

function inboxMessage(
  overrides: Partial<ParsedGmailMessageFixture> &
    Pick<ParsedGmailMessageFixture, 'eventId' | 'providerMessageId'>,
): ParsedGmailMessageFixture {
  return {
    providerThreadId: `thread_${overrides.providerMessageId}`,
    internalDate: now,
    fromAddress: 'sender@example.com',
    toAddresses: ['owner@example.com'],
    subject: 'Hello',
    snippet: 'Body preview',
    labelIds: ['INBOX'],
    hasAttachments: false,
    attachmentMetadata: [],
    ...overrides,
  };
}

describe('buildGmailHistoryPageExcerptIntents', () => {
  it('collects one intent per eligible excerpt-bearing message', () => {
    const intents = buildGmailHistoryPageExcerptIntents({
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_a'),
          providerMessageId: 'msg_a',
          excerptId: asTemporaryCommunicationExcerptId('ex_a'),
          excerptContent: 'excerpt a',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_b'),
          providerMessageId: 'msg_b',
          excerptId: asTemporaryCommunicationExcerptId('ex_b'),
          excerptContent: 'excerpt b',
          excerptPurgeAt: purgeAt,
        }),
      ],
      existingEventIdByProviderMessageId: new Map(),
    });

    expect(intents).toEqual([
      {
        communicationEventId: 'evt_a',
        excerptId: 'ex_a',
        content: 'excerpt a',
        byteLength: measureExcerptByteLength('excerpt a'),
        purgeAt,
      },
      {
        communicationEventId: 'evt_b',
        excerptId: 'ex_b',
        content: 'excerpt b',
        byteLength: measureExcerptByteLength('excerpt b'),
        purgeAt,
      },
    ]);
  });

  it('uses the existing event id and keeps the first excerpt id with last content', () => {
    const intents = buildGmailHistoryPageExcerptIntents({
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_ignored'),
          providerMessageId: 'msg_dup',
          excerptId: asTemporaryCommunicationExcerptId('ex_first'),
          excerptContent: 'first body',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_also_ignored'),
          providerMessageId: 'msg_dup',
          excerptId: asTemporaryCommunicationExcerptId('ex_last'),
          excerptContent: 'last body',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
      existingEventIdByProviderMessageId: new Map([['msg_dup', 'evt_existing']]),
    });

    expect(intents).toEqual([
      {
        communicationEventId: 'evt_existing',
        excerptId: 'ex_first',
        content: 'last body',
        byteLength: measureExcerptByteLength('last body'),
        purgeAt,
      },
    ]);
  });

  it('keeps the first new event id when a provider message repeats on the page', () => {
    const intents = buildGmailHistoryPageExcerptIntents({
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_first'),
          providerMessageId: 'msg_new_dup',
          excerptId: asTemporaryCommunicationExcerptId('ex_first'),
          excerptContent: 'first body',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_second'),
          providerMessageId: 'msg_new_dup',
          excerptId: asTemporaryCommunicationExcerptId('ex_second'),
          excerptContent: 'second body',
          excerptPurgeAt: laterPurgeAt,
        }),
      ],
      existingEventIdByProviderMessageId: new Map(),
    });

    expect(intents).toEqual([
      {
        communicationEventId: 'evt_first',
        excerptId: 'ex_first',
        content: 'second body',
        byteLength: measureExcerptByteLength('second body'),
        purgeAt,
      },
    ]);
  });

  it('skips ineligible messages and messages without a usable purge deadline', () => {
    const withoutDefault = buildGmailHistoryPageExcerptIntents({
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_sent'),
          providerMessageId: 'msg_sent',
          labelIds: ['SENT'],
          excerptId: asTemporaryCommunicationExcerptId('ex_sent'),
          excerptContent: 'should skip',
          excerptPurgeAt: purgeAt,
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_no_purge'),
          providerMessageId: 'msg_no_purge',
          excerptId: asTemporaryCommunicationExcerptId('ex_no_purge'),
          excerptContent: 'no deadline',
        }),
        inboxMessage({
          eventId: asCommunicationEventId('evt_ok'),
          providerMessageId: 'msg_ok',
          excerptId: asTemporaryCommunicationExcerptId('ex_ok'),
          excerptContent: 'kept',
          excerptPurgeAt: purgeAt,
        }),
      ],
      existingEventIdByProviderMessageId: new Map(),
    });
    expect(withoutDefault).toEqual([
      {
        communicationEventId: 'evt_ok',
        excerptId: 'ex_ok',
        content: 'kept',
        byteLength: measureExcerptByteLength('kept'),
        purgeAt,
      },
    ]);

    const withDefault = buildGmailHistoryPageExcerptIntents({
      messages: [
        inboxMessage({
          eventId: asCommunicationEventId('evt_default'),
          providerMessageId: 'msg_default',
          excerptId: asTemporaryCommunicationExcerptId('ex_default'),
          excerptContent: 'uses default',
        }),
      ],
      existingEventIdByProviderMessageId: new Map(),
      defaultExcerptPurgeAt: purgeAt,
    });
    expect(withDefault).toEqual([
      {
        communicationEventId: 'evt_default',
        excerptId: 'ex_default',
        content: 'uses default',
        byteLength: measureExcerptByteLength('uses default'),
        purgeAt,
      },
    ]);
  });

  it('fails closed on oversize excerpt content before persistence', () => {
    expect(() =>
      buildGmailHistoryPageExcerptIntents({
        messages: [
          inboxMessage({
            eventId: asCommunicationEventId('evt_ok'),
            providerMessageId: 'msg_ok',
            excerptId: asTemporaryCommunicationExcerptId('ex_ok'),
            excerptContent: 'ok',
            excerptPurgeAt: purgeAt,
          }),
          inboxMessage({
            eventId: asCommunicationEventId('evt_big'),
            providerMessageId: 'msg_big',
            excerptId: asTemporaryCommunicationExcerptId('ex_big'),
            excerptContent: 'x'.repeat(MAX_GMAIL_EXCERPT_BYTES + 1),
            excerptPurgeAt: purgeAt,
          }),
        ],
        existingEventIdByProviderMessageId: new Map(),
      }),
    ).toThrow(DomainError);
  });
});
