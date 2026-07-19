import { createOwnerTask, listOwnerTasks } from '@/lib/tasks';
import { runOwnerTaskRoute } from '@/lib/tasks/route-context';
import { parseCreateTaskBody } from '@/lib/tasks/validate-body';
import { parseLimitQuery, readJsonBody, requireObjectBody } from '@/lib/http/request';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const url = new URL(request.url);
    const limitParsed = parseLimitQuery(url.searchParams.get('limit'));
    if (!limitParsed.ok) {
      return limitParsed.response;
    }
    const cursor = url.searchParams.get('cursor');
    const page = await listOwnerTasks({
      db: ctx.db,
      owner: ctx.owner,
      now: ctx.now,
      cursor,
      limit: limitParsed.limit,
    });
    return NextResponse.json(page);
  });
}

export async function POST(request: Request) {
  return runOwnerTaskRoute(request, async (ctx) => {
    const json = await readJsonBody(request);
    if (!json.ok) {
      return json.response;
    }
    const object = requireObjectBody(json.body);
    if (!object.ok) {
      return object.response;
    }
    const parsed = parseCreateTaskBody(object.value);
    if (!parsed.ok) {
      return parsed.response;
    }

    const result = await createOwnerTask({
      db: ctx.db,
      owner: ctx.owner,
      now: ctx.now,
      requestId: ctx.requestId,
      summaryPoints: parsed.value.summaryPoints as never,
      dueAt: parsed.value.dueAt,
      priority: parsed.value.priority,
      sourceReference: parsed.value.sourceReference as never,
    });

    // OpenAPI createTask 201 declares Task body only (including body `etag`); no HTTP ETag header.
    return NextResponse.json(result.task, { status: 201 });
  });
}
