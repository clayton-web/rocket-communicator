import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import {
  createRequestId,
  elapsedMs,
  emitOperationalLog,
  isNextControlFlowError,
  monotonicNowMs,
  runWithRequestContext,
} from '@/lib/observability';
import styles from '../tasks/tasks.module.css';

export const dynamic = 'force-dynamic';

/**
 * Owner attention and operational-status destination (P1.4 / D118).
 *
 * D118 placed this destination in the Owner shell rather than inventing a second surface for
 * it later, so the navigation shape stays stable when A8 gives it real content. Until then it
 * is genuinely empty, and it says so.
 *
 * The copy is constrained by D089 and D112: it must not imply that anything is being watched,
 * queued, counted, or scheduled, because none of that is true here. An empty page that hints
 * at invisible machinery is worse than no page — the Owner would trust a safety net that does
 * not exist. It also avoids claiming anything about the wider system: Gmail polling and
 * suggestion processing endpoints do exist, so a blanket "nothing is running" would be its own
 * falsehood. Every statement below is scoped to this page.
 *
 * Reads nothing. No database query, no Task data, no counts.
 */
export default async function AttentionPage() {
  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate: '/attention',
      operation: 'owner_attention_page',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      try {
        const authStarted = monotonicNowMs();
        await requireOwnerPage('/attention');
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_authentication',
          routeTemplate: '/attention',
          durationMs: elapsedMs(authStarted),
          outcome: 'ok',
        });

        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_attention_page',
          routeTemplate: '/attention',
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });

        return (
          <>
            <h1 className={styles.title}>Attention</h1>
            <p className={styles.muted} role="status">
              There is nothing to show here.
            </p>
            <p className={styles.muted}>
              This destination is where Tasks needing your attention and operational status will
              appear. Neither is built yet, so this page is empty by design rather than because
              something failed.
            </p>
            <p className={styles.muted}>
              This page does not monitor anything, hold a queue, count anything, or track a
              schedule, and nothing on it updates on its own. The Tasks page remains the complete
              and current list of your Tasks.
            </p>
          </>
        );
      } catch (error) {
        // A login redirect is expected control flow, not an operational failure.
        if (isNextControlFlowError(error)) {
          throw error;
        }
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_attention_page',
          routeTemplate: '/attention',
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        throw error;
      }
    },
  );
}
