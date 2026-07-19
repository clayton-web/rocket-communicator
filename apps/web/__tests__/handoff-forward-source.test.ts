// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asOrganizationId, asTaskId, type Task } from '@aicaa/domain';
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
});
