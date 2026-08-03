import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { getOwnerTask } from '@/lib/tasks';
import { listOwnerRecipients } from '@/lib/recipients';
import { getGmailConnection } from '@/lib/gmail/service';
import { getOwnerTaskReminder } from '@/lib/reminders';
import { requireOwnerPage } from '@/lib/owner/require-owner-page';
import { isTaskServiceError, readTaskServiceErrorCode } from '@/lib/errors/safe-error-shapes';
import {
  createRequestId,
  emitOperationalLog,
  elapsedMs,
  isNextControlFlowError,
  isNextNotFoundControlFlowError,
  monotonicNowMs,
  runWithRequestContext,
} from '@/lib/observability';
import { TaskDetail } from '../_components/task-detail';

export const dynamic = 'force-dynamic';

/**
 * Owner Task detail RSC.
 * Timings measure server data/auth work only — not full browser render or Web Vitals.
 * Spans: `owner_authentication`, `owner_task_detail_load`, and wrapper `owner_task_detail_page`.
 */
export default async function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;

  return runWithRequestContext(
    {
      requestId: createRequestId(),
      routeTemplate: '/tasks/[taskId]',
      operation: 'owner_task_detail_page',
      correlationId: null,
    },
    async () => {
      const started = monotonicNowMs();
      try {
        const authStarted = monotonicNowMs();
        const authenticated = await requireOwnerPage(`/tasks/${taskId}`);
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_authentication',
          routeTemplate: '/tasks/[taskId]',
          durationMs: elapsedMs(authStarted),
          outcome: 'ok',
        });

        const db = await getDb();
        const now = new Date().toISOString();

        const loadStarted = monotonicNowMs();
        let task;
        try {
          task = await getOwnerTask({
            db,
            owner: authenticated.actor,
            taskId,
            now,
          });
        } catch (error) {
          if (isTaskServiceError(error) && readTaskServiceErrorCode(error) === 'NOT_FOUND') {
            notFound();
          }
          throw error;
        }

        /*
         * The reminder projection is loaded here, through the same service the API route uses,
         * rather than fetched by the panel after mount (A8.6b).
         *
         * Two reasons. The panel is correct on first paint, so there is no flash of "no reminders"
         * on a Task that has them — the state an Owner would most readily believe and act on. And it
         * costs no extra round trip on a page that is already reading the database: the read joins
         * the batch below instead of becoming a request the browser makes after the HTML arrives.
         *
         * A reminder read failure is deliberately not caught. It reaches the Task error boundary
         * like any other load failure, because a Task page that quietly rendered "no reminders" when
         * the schedule could not be read would be stating the one thing most likely to be wrong.
         */
        const [recipientsPage, connection, reminder] = await Promise.all([
          listOwnerRecipients({
            db,
            owner: authenticated.actor,
            cursor: null,
            limit: 25,
          }),
          getGmailConnection({ owner: authenticated.actor, db }),
          getOwnerTaskReminder({ db, owner: authenticated.actor, taskId: task.id, now }),
        ]);
        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_task_detail_load',
          routeTemplate: '/tasks/[taskId]',
          durationMs: elapsedMs(loadStarted),
          outcome: 'ok',
        });

        emitOperationalLog({
          event: 'operation_timing',
          level: 'info',
          operation: 'owner_task_detail_page',
          routeTemplate: '/tasks/[taskId]',
          durationMs: elapsedMs(started),
          outcome: 'ok',
        });

        return (
          <TaskDetail
            task={task}
            initialRecipients={recipientsPage.items}
            recipientsNextCursor={recipientsPage.nextCursor ?? null}
            initialConnection={connection}
            initialReminder={reminder}
          />
        );
      } catch (error) {
        // Login redirects and notFound() are expected control flow — not infra errors.
        if (isNextControlFlowError(error)) {
          if (isNextNotFoundControlFlowError(error)) {
            emitOperationalLog({
              event: 'operation_timing',
              level: 'info',
              operation: 'owner_task_detail_page',
              routeTemplate: '/tasks/[taskId]',
              durationMs: elapsedMs(started),
              outcome: 'rejected',
            });
          }
          throw error;
        }
        emitOperationalLog({
          event: 'operation_timing',
          level: 'error',
          operation: 'owner_task_detail_page',
          routeTemplate: '/tasks/[taskId]',
          durationMs: elapsedMs(started),
          outcome: 'error',
        });
        throw error;
      }
    },
  );
}
