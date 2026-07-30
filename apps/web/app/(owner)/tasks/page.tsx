import { getDb } from '@/lib/db/server';
import { listOwnerTasks } from '@/lib/tasks';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import {
  createRequestId,
  emitOperationalLog,
  elapsedMs,
  isNextControlFlowError,
  isNextNotFoundControlFlowError,
  monotonicNowMs,
  runWithRequestContext,
} from '@/lib/observability';
import { TaskList } from './_components/task-list';

export const dynamic = 'force-dynamic';

/**
 * Owner Task list RSC.
 * Timings measure server data/auth work only — not full browser render or Web Vitals.
 * Spans: `owner_authentication`, `owner_task_list_load`, and wrapper `owner_task_list_page`.
 */
export default async function TasksPage() {
  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate: '/tasks',
      operation: 'owner_task_list_page',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      try {
        const authStarted = monotonicNowMs();
        const authenticated = await requireOwnerPage('/tasks');
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_authentication',
          routeTemplate: '/tasks',
          durationMs: elapsedMs(authStarted),
          outcome: 'ok',
        });

        const db = await getDb();
        const now = new Date().toISOString();
        const loadStarted = monotonicNowMs();
        const page = await listOwnerTasks({
          db,
          owner: authenticated.actor,
          now,
          limit: 25,
        });
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_task_list_load',
          routeTemplate: '/tasks',
          durationMs: elapsedMs(loadStarted),
          outcome: 'ok',
        });

        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_task_list_page',
          routeTemplate: '/tasks',
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });

        return <TaskList items={page.items} nextCursor={page.nextCursor} />;
      } catch (error) {
        // Auth redirects and not-found control flow are expected — not operational errors.
        if (isNextControlFlowError(error)) {
          if (isNextNotFoundControlFlowError(error)) {
            emitOperationalLog({
              event: 'operation_timing',
              level: 'info',
              operation: 'owner_task_list_page',
              routeTemplate: '/tasks',
              durationMs: elapsedMs(started),
              outcome: 'rejected',
            });
          }
          throw error;
        }
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_task_list_page',
          routeTemplate: '/tasks',
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        throw error;
      }
    },
  );
}
