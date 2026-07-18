import { listOwnerSuggestions } from '@/lib/suggestions';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseLimitQuery } from '@/lib/http/request';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const url = new URL(request.url);
    const limitParsed = parseLimitQuery(url.searchParams.get('limit'));
    if (!limitParsed.ok) {
      return limitParsed.response;
    }
    const cursor = url.searchParams.get('cursor');
    const page = await listOwnerSuggestions({
      db: ctx.db,
      owner: ctx.owner,
      cursor,
      limit: limitParsed.limit,
    });
    return NextResponse.json(page);
  });
}
