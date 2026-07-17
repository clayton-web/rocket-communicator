// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractMessageIdsFromHistory,
  getMessage,
  getProfile,
  listHistory,
} from '@/lib/gmail/gmail-api-client';
import { GmailSyncError } from '@/lib/gmail/sync-errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('A5.4 Gmail API client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getProfile returns historyId as a string', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        emailAddress: 'owner@example.com',
        historyId: 9876543210987,
      }),
    );

    const profile = await getProfile('access_token_value');
    expect(profile.historyId).toBe('9876543210987');
    expect(typeof profile.historyId).toBe('string');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access_token_value',
        }),
      }),
    );
  });

  it('listHistory maps 404 to invalid_history', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    await expect(listHistory({ accessToken: 't', startHistoryId: '100' })).rejects.toMatchObject({
      code: 'invalid_history',
    });
  });

  it('maps 429 to rate_limited', async () => {
    fetchMock.mockResolvedValue(new Response('slow down', { status: 429 }));

    await expect(getProfile('t')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(GmailSyncError).toBeTruthy();
  });

  it('extractMessageIdsFromHistory dedupes Inbox additions and removals', () => {
    const ids = extractMessageIdsFromHistory([
      {
        id: '1',
        messagesAdded: [{ message: { id: 'msg_a' } }, { message: { id: 'msg_b' } }],
      },
      {
        id: '2',
        messagesAdded: [{ message: { id: 'msg_a' } }],
        labelsAdded: [
          { message: { id: 'msg_c' }, labelIds: ['INBOX'] },
          { message: { id: 'msg_d' }, labelIds: ['STARRED'] },
          { message: { id: 'msg_b' }, labelIds: ['INBOX', 'UNREAD'] },
        ],
        labelsRemoved: [
          { message: { id: 'msg_e' }, labelIds: ['INBOX'] },
          { message: { id: 'msg_f' }, labelIds: ['STARRED'] },
        ],
      },
    ]);

    expect(ids).toEqual(['msg_a', 'msg_b', 'msg_c', 'msg_e']);
  });

  it('getMessage uses format=full and never calls the attachments endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: 'msg_1',
        threadId: 'thread_1',
        labelIds: ['INBOX'],
        internalDate: '1',
        payload: { mimeType: 'text/plain', body: { data: 'YQ' } },
      }),
    );

    const message = await getMessage({ accessToken: 't', messageId: 'msg_1' });
    expect(message.id).toBe('msg_1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/messages/msg_1?');
    expect(url).toContain('format=full');
    expect(url).toContain('fields=');
    expect(url).not.toContain('/attachments/');
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('/attachments/');
    }
  });
});
