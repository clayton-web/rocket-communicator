// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAccessToken, mockSetCredentials } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockSetCredentials: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    setCredentials: mockSetCredentials,
    getAccessToken: mockGetAccessToken,
  })),
}));

import { getGmailAccessToken } from '@/lib/gmail/access-token';
import { GmailSyncError } from '@/lib/gmail/sync-errors';

const refreshToken = 'rt_secret_do_not_leak_abc123';

describe('A5.4 Gmail access token refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the access token on success', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'ya29.access_token_value' });

    await expect(getGmailAccessToken({ refreshToken })).resolves.toBe('ya29.access_token_value');
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: refreshToken });
  });

  it('maps invalid_grant to needs_reauth without leaking tokens', async () => {
    mockGetAccessToken.mockRejectedValue(
      Object.assign(new Error(`invalid_grant: token=${refreshToken}`), { status: 400 }),
    );

    let caught: unknown;
    try {
      await getGmailAccessToken({ refreshToken });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GmailSyncError);
    expect((caught as GmailSyncError).code).toBe('needs_reauth');
    expect((caught as GmailSyncError).message).not.toContain(refreshToken);
    expect((caught as GmailSyncError).message).not.toMatch(/ya29|access_token|rt_secret/i);
    expect(JSON.stringify(caught)).not.toContain(refreshToken);
  });

  it('maps empty token refresh to needs_reauth without leaking the refresh token', async () => {
    mockGetAccessToken.mockResolvedValue({ token: null });

    try {
      await getGmailAccessToken({ refreshToken });
      expect.unreachable('expected needs_reauth');
    } catch (error) {
      expect(error).toBeInstanceOf(GmailSyncError);
      expect((error as GmailSyncError).code).toBe('needs_reauth');
      expect(String((error as Error).message)).not.toContain(refreshToken);
    }
  });
});
