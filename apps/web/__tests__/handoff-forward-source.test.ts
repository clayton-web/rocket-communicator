// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  asOrganizationId,
  asTaskId,
  evaluateGmailHandoffPrerequisites,
  hasUsableGmailSourceIdentifiers,
  type Task,
} from '@aicaa/domain';
import { resolveTaskGmailForwardSource } from '@/lib/handoff/forward-source';

const NOW = '2026-07-18T18:00:00.000Z';

function taskWithSource(sourceReference: Task['sourceReference']): Task {
  return {
    id: asTaskId('task_fwd'),
    organizationId: asOrganizationId('org_fwd'),
    status: 'open',
    summaryPoints: [],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    sourceReference,
  };
}

describe('A7.7 trusted Task Gmail forward-source resolver', () => {
  it('resolves provider message id from trusted Task sourceReference', () => {
    const result = resolveTaskGmailForwardSource({
      organizationId: 'org_fwd',
      accountId: 'acct_1',
      attemptId: 'att_1',
      task: taskWithSource({
        id: 'src_1',
        sourceType: 'gmail',
        dedupeKey: 'gmail:msg_abc',
        capturedAt: NOW,
        externalIds: [{ provider: 'gmail', idType: 'message_id', id: 'msg_abc' }],
      }),
    });
    expect(result).toEqual({
      providerMessageId: 'msg_abc',
      organizationId: 'org_fwd',
      accountId: 'acct_1',
    });
  });

  it('returns undefined for non-gmail source (no silent downgrade input)', () => {
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource({
          id: 'src_1',
          sourceType: 'manual',
          dedupeKey: 'manual:1',
          capturedAt: NOW,
        }),
      }),
    ).toBeUndefined();
  });

  it('returns undefined when gmail source lacks a usable message_id', () => {
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource({
          id: 'src_1',
          sourceType: 'gmail',
          dedupeKey: 'gmail:x',
          capturedAt: NOW,
          externalIds: [{ provider: 'gmail', idType: 'thread_id', id: 'thr_1' }],
        }),
      }),
    ).toBeUndefined();
  });

  it('resolves the exact message from a persisted Review-era gmail:message + gmail:thread Task', () => {
    const sourceReference = {
      id: 'evt_review_canary',
      sourceType: 'gmail' as const,
      dedupeKey: 'gmail:msg_review_canary',
      capturedAt: NOW,
      externalIds: [
        { provider: 'gmail', idType: 'message', id: 'msg_review_canary' },
        { provider: 'gmail', idType: 'thread', id: 'thread_review_canary' },
      ],
    };
    expect(hasUsableGmailSourceIdentifiers(sourceReference)).toBe(true);
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource(sourceReference),
      }),
    ).toEqual({
      providerMessageId: 'msg_review_canary',
      organizationId: 'org_fwd',
      accountId: 'acct_1',
    });
  });

  it('does not treat a thread-only source as an exact Gmail message', () => {
    const sourceReference = {
      id: 'src_thread_only',
      sourceType: 'gmail' as const,
      dedupeKey: 'gmail:thread_only',
      capturedAt: NOW,
      externalIds: [{ provider: 'gmail', idType: 'thread', id: 'thread_only' }],
    };
    expect(hasUsableGmailSourceIdentifiers(sourceReference)).toBe(false);
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource(sourceReference),
      }),
    ).toBeUndefined();
  });

  it('ignores empty message ids', () => {
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource({
          id: 'src_1',
          sourceType: 'gmail',
          dedupeKey: 'gmail:x',
          capturedAt: NOW,
          externalIds: [{ provider: 'gmail', idType: 'message_id', id: '   ' }],
        }),
      }),
    ).toBeUndefined();
  });

  it('preflight and resolver agree: Review-era source is resolvable, invalid source stays fail-closed', () => {
    const connected = {
      connected: true,
      canRead: true,
      canSend: true,
      requiresSendReconsent: false,
    };
    const reviewEra = {
      id: 'evt_review_canary',
      sourceType: 'gmail' as const,
      dedupeKey: 'gmail:msg_review_canary',
      capturedAt: NOW,
      externalIds: [
        { provider: 'gmail', idType: 'message', id: 'msg_review_canary' },
        { provider: 'gmail', idType: 'thread', id: 'thread_review_canary' },
      ],
    };
    const missing = {
      id: 'src_missing',
      sourceType: 'gmail' as const,
      dedupeKey: 'gmail:missing',
      capturedAt: NOW,
    };

    expect(
      evaluateGmailHandoffPrerequisites({
        deliveryPath: 'gmail_forward',
        connection: connected,
        sourceReference: reviewEra,
      }).ok,
    ).toBe(true);
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource(reviewEra),
      })?.providerMessageId,
    ).toBe('msg_review_canary');

    expect(
      evaluateGmailHandoffPrerequisites({
        deliveryPath: 'gmail_forward',
        connection: connected,
        sourceReference: missing,
      }).ok,
    ).toBe(false);
    expect(
      resolveTaskGmailForwardSource({
        organizationId: 'org_fwd',
        accountId: 'acct_1',
        attemptId: 'att_1',
        task: taskWithSource(missing),
      }),
    ).toBeUndefined();
  });
});
