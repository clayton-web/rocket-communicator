import 'server-only';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { mapSyncRunToDto, type GmailSyncRunDto } from './sync-dto';
import {
  runOwnerGmailSync,
  type GmailSyncEngineDeps,
  type OwnerGmailSyncResult,
} from './sync-engine';
import { mapConnectionToDto } from './connection-dto';
import type { OwnerGmailContext } from './service';

export type { OwnerGmailSyncResult };

/** Owner-triggered manual Gmail sync (initial cursor or incremental History). */
export async function syncOwnerGmail(
  ctx: OwnerGmailContext,
  deps?: GmailSyncEngineDeps,
): Promise<{ run: GmailSyncRunDto; connection: ReturnType<typeof mapConnectionToDto> }> {
  const result = await runOwnerGmailSync(ctx, deps);
  return {
    run: mapSyncRunToDto(result.run),
    connection: result.connection,
  };
}

/** Cursor-paginated Owner sync-run listing. Non-mutating. */
export async function listOwnerGmailSyncRuns(
  ctx: Pick<OwnerGmailContext, 'owner' | 'db'>,
  query: { cursor?: string | null; limit?: number },
): Promise<{ items: GmailSyncRunDto[]; nextCursor: string | null }> {
  const runtime = await loadDbRuntime();
  const page = await runtime.listGmailSyncRuns(ctx.db, {
    organizationId: ctx.owner.organizationId,
    cursor: query.cursor,
    limit: query.limit,
  });
  return {
    items: page.items.map(mapSyncRunToDto),
    nextCursor: page.nextCursor,
  };
}
