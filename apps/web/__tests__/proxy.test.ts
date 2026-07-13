import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy, config } from '@/proxy';

const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });

vi.mock('@/lib/supabase/proxy', () => ({
  createProxyClient: () => ({
    auth: { getUser },
  }),
}));

describe('proxy entry point', () => {
  beforeEach(() => {
    getUser.mockClear();
    vi.spyOn(NextResponse, 'next').mockImplementation(
      () => new NextResponse(null, { status: 200 }),
    );
  });

  it('exports the Next.js proxy matcher config', () => {
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ]);
  });

  it('refreshes the session via auth.getUser()', async () => {
    const request = new NextRequest('http://localhost:3000/');
    const response = await proxy(request);

    expect(getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});
