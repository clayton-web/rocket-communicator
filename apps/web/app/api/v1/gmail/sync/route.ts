import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { syncOwnerGmail } from '@/lib/gmail/sync-service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST /api/v1/gmail/sync
 * Authenticated Owner-only manual Gmail sync. Optional empty JSON body.
 * Returns safe run + connection DTOs. Lock conflicts map to 409.
 * needs_reauth / resync_required complete as 200 with outcome on the run DTO.
 */
export async function POST(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const bodyResult = await readOptionalEmptyBody(request);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const result = await syncOwnerGmail({
      owner: ctx.owner,
      db: ctx.db,
      now: ctx.now,
      requestId: ctx.requestId,
    });

    return NextResponse.json(
      { run: result.run, connection: result.connection },
      { headers: NO_STORE },
    );
  });
}

async function readOptionalEmptyBody(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true };
  }
  return parseEmptyObject(text);
}

function parseEmptyObject(text: string): { ok: true } | { ok: false; response: NextResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      response: jsonErrorResponse('VALIDATION_ERROR', 'Request body must be valid JSON.', 400),
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'Request body must be an empty JSON object.',
        400,
      ),
    };
  }
  if (Object.keys(parsed as Record<string, unknown>).length > 0) {
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'Request body must be an empty JSON object.',
        400,
      ),
    };
  }
  return { ok: true };
}
