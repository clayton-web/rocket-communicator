import Link from 'next/link';
import type { components } from '@aicaa/contracts/schema';
import { formatOwnerDate } from '@/lib/presentation/datetime';
import { deriveTaskTitle } from '@/lib/presentation/task-title';
import {
  assignmentLabel,
  taskStatusLabel,
  taskStatusTone,
  taskUrgencyLabel,
  urgencyTone,
} from '@/lib/presentation/task-status';
import { EmptyState } from '../../_components/empty-state';
import { PageHeader } from '../../_components/page-header';
import { StatusBadge } from '../../_components/status-badge';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];

/**
 * Owner Task list (P1.4).
 *
 * Presentation only. The order is exactly the order the server returned — P1.4 adds no
 * sorting, grouping, filtering, section, or count, so what the Owner sees is what the
 * approved list query produced.
 *
 * Delivery state appears here only when it has failed. A failed handoff is something the
 * Owner needs to notice without opening the Task; "Delivery pending" on every assigned row
 * would be noise that pushes the genuine failures out of view. Full delivery state is on the
 * Task detail.
 */
export function TaskList({ items, nextCursor }: { items: TaskDto[]; nextCursor: string | null }) {
  return (
    // The Owner shell layout supplies the container, landmark, and navigation.
    <>
      <PageHeader
        title="Tasks"
        description="Open a Task to review details and hand it off to a Recipient."
      />
      {items.length === 0 ? (
        <EmptyState
          message="No Tasks yet."
          explanation="Tasks you create, or approve from a suggestion, will appear here. This list is not filtered."
        />
      ) : (
        <ul className={styles.list}>
          {items.map((task) => {
            const urgency = task.derivedUrgency ?? null;
            const urgencyText = taskUrgencyLabel(urgency);
            const deliveryFailed = task.assignment?.deliveryStatus === 'failed';

            return (
              <li key={task.id}>
                <Link href={`/tasks/${task.id}`}>
                  <span className={styles.itemTitle}>{deriveTaskTitle(task)}</span>
                  <span className={styles.itemBadges}>
                    <StatusBadge
                      label={taskStatusLabel(task.status)}
                      tone={taskStatusTone(task.status)}
                    />
                    {urgencyText && urgency ? (
                      <StatusBadge label={urgencyText} tone={urgencyTone(urgency)} />
                    ) : null}
                    <StatusBadge label={assignmentLabel(Boolean(task.assignment))} />
                    {deliveryFailed ? (
                      <StatusBadge label="Delivery failed" tone="critical" />
                    ) : null}
                  </span>
                  {task.dueAt ? (
                    <span className={styles.meta}>Due date: {formatOwnerDate(task.dueAt)}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor ? (
        <p className={styles.muted}>
          More Tasks are available via the API cursor; this thin list shows the first page.
        </p>
      ) : null}
    </>
  );
}
