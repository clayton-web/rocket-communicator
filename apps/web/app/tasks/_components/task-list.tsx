import Link from 'next/link';
import type { components } from '@aicaa/contracts/schema';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];

function taskTitle(task: TaskDto): string {
  const first = task.summaryPoints[0];
  if (!first) {
    return `Task ${task.id.slice(0, 8)}`;
  }
  if ('value' in first && typeof first.value === 'string' && first.value.trim()) {
    return first.value.trim();
  }
  return first.label || `Task ${task.id.slice(0, 8)}`;
}

export function TaskList({ items, nextCursor }: { items: TaskDto[]; nextCursor: string | null }) {
  return (
    <div className={styles.wrap}>
      <nav className={styles.nav} aria-label="Owner">
        <Link href="/">Home</Link>
        <Link href="/tasks" aria-current="page">
          Tasks
        </Link>
      </nav>
      <h1 className={styles.title}>Tasks</h1>
      <p className={styles.muted}>Open a Task to review details and hand it off to a Recipient.</p>
      {items.length === 0 ? (
        <p className={styles.muted} role="status">
          No Tasks yet.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((task) => (
            <li key={task.id}>
              <Link href={`/tasks/${task.id}`}>
                {taskTitle(task)}
                <span className={styles.meta}>
                  {task.status}
                  {task.assignment ? ' · assigned' : ' · unassigned'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <p className={styles.muted}>
          More Tasks are available via the API cursor; this thin list shows the first page.
        </p>
      ) : null}
    </div>
  );
}
