import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/v1/session/route';

vi.mock('@/lib/auth/require-owner', () => ({
  requireOwnerSession: vi.fn(),
}));

import { requireOwnerSession } from '@/lib/auth/require-owner';

describe('GET /api/v1/session', () => {
  beforeEach(() => {
    vi.mocked(requireOwnerSession).mockReset();
  });

  it('returns 401 for unauthenticated requests', async () => {
    vi.mocked(requireOwnerSession).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toBeTruthy();
  });

  it('returns OpenAPI-compatible session for authenticated Owner', async () => {
    vi.mocked(requireOwnerSession).mockResolvedValue({
      ownerId: 'user-abc',
      organizationId: 'org_test_123',
      role: 'owner',
      displayName: 'Owner Name',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ownerId: 'user-abc',
      organizationId: 'org_test_123',
      role: 'owner',
      displayName: 'Owner Name',
    });
  });
});
