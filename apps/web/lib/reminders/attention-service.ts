import 'server-only';
import type { DbClient } from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { toOwnerAttentionView, type OwnerAttentionView } from './attention';

/**
 * The `/attention` read (A8.6a).
 *
 * Thin on purpose. It resolves the repository function through the traced runtime, applies the one
 * bound the surface has, and hands the rows to the projection — the page never sees a repository
 * row, and the projection never sees a database client.
 *
 * Owner-facing and organization-scoped, unlike every other bounded reminder read in this package:
 * those are global worker scans whose batches span organizations by design. The organization here
 * comes from the caller's authenticated session and is applied in the query rather than after it.
 */

/**
 * Largest batch the Attention surface will read.
 *
 * Bounded because an Owner-facing read whose cost is set by how badly things have gone is a page
 * that gets slowest exactly when it matters most. Well above any plausible number of simultaneously
 * stopped schedules for a single organization, and a filled batch is disclosed to the Owner rather
 * than quietly dropped.
 */
export const ATTENTION_LIST_LIMIT = 50;

export async function loadOwnerAttentionView(input: {
  readonly db: DbClient;
  readonly organizationId: string;
}): Promise<OwnerAttentionView> {
  const { listReminderSchedulesRequiringOwnerAttention } = await loadDbRuntime();
  const rows = await listReminderSchedulesRequiringOwnerAttention(input.db, {
    organizationId: input.organizationId,
    limit: ATTENTION_LIST_LIMIT,
  });
  return toOwnerAttentionView(rows, ATTENTION_LIST_LIMIT);
}
