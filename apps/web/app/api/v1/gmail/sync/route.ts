import { NextResponse } from 'next/server';
import { jsonErrorResponse } from '@/lib/auth/http';
import { runOwnerGmailRoute } from '@/lib/gmail/route-context';
import { GMAIL_HISTORY_CURSOR_RESEED_CONFIRMATION } from '@/lib/gmail/sync-engine';
import { syncOwnerGmail } from '@/lib/gmail/sync-service';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * POST /api/v1/gmail/sync
 * Authenticated Owner-only manual Gmail sync. Optional JSON body.
 * Empty body is ordinary initial/incremental sync. Reseed from resync_required
 * requires confirmHistoryCursorReseed=acknowledged_continuity_gap.
 * Returns safe run + connection DTOs. Lock conflicts map to 409.
 * needs_reauth / resync_required complete as 200 with outcome on the run DTO
 * unless the Owner explicitly confirmed cursor reseed.
 */
export async function POST(request: Request) {
  return runOwnerGmailRoute(request, async (ctx) => {
    const bodyResult = await readOptionalSyncBody(request);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const result = await syncOwnerGmail(
      {
        owner: ctx.owner,
        db: ctx.db,
        now: ctx.now,
        requestId: ctx.requestId,
      },
      undefined,
      { confirmHistoryCursorReseed: bodyResult.confirmHistoryCursorReseed },
    );

    return NextResponse.json(
      { run: result.run, connection: result.connection },
      { headers: NO_STORE },
    );
  });
}

async function readOptionalSyncBody(
  request: Request,
): Promise<
  | { ok: true; confirmHistoryCursorReseed: boolean }
  | { ok: false; response: NextResponse }
> {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true, confirmHistoryCursorReseed: false };
  }
  return parseSyncBody(text);
}

function parseSyncBody(
  text: string,
): { ok: true; confirmHistoryCursorReseed: boolean } | { ok: false; response: NextResponse } {
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
        'Request body must be a JSON object.',
        400,
      ),
    };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return { ok: true, confirmHistoryCursorReseed: false };
  }
  if (keys.length === 1 && keys[0] === 'confirmHistoryCursorReseed') {
    if (record.confirmHistoryCursorReseed === GMAIL_HISTORY_CURSOR_RESEED_CONFIRMATION) {
      return { ok: true, confirmHistoryCursorReseed: true };
    }
    return {
      ok: false,
      response: jsonErrorResponse(
        'VALIDATION_ERROR',
        'confirmHistoryCursorReseed must be acknowledged_continuity_gap.',
        400,
      ),
    };
  }
  return {
    ok: false,
    response: jsonErrorResponse(
      'VALIDATION_ERROR',
      'Request body must be empty or only confirmHistoryCursorReseed.',
      400,
    ),
  };
}
