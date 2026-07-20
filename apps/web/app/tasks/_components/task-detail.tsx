'use client';

import Link from 'next/link';
import type { components } from '@aicaa/contracts/schema';
import { HandoffPanel } from './handoff-panel';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type GmailConnectionDto = components['schemas']['GmailConnection'];

function summaryText(point: TaskDto['summaryPoints'][number]): string {
  if ('value' in point && typeof point.value === 'string') {
    return point.value;
  }
  return point.label;
}

export function TaskDetail({
  task,
  initialRecipients,
  recipientsNextCursor,
  initialConnection,
}: {
  task: TaskDto;
  initialRecipients: RecipientDto[];
  recipientsNextCursor: string | null;
  initialConnection: GmailConnectionDto;
}) {
  return (
    <div className={styles.wrap}>
      <nav className={styles.nav} aria-label="Owner">
        <Link href="/">Home</Link>
        <Link href="/tasks">Tasks</Link>
      </nav>
      <h1 className={styles.title}>Task</h1>
      <p className={styles.muted}>
        Status: {task.status}
        {task.assignment ? (
          <span className={styles.statusPill}>Assigned</span>
        ) : (
          <span className={styles.statusPill}>Unassigned</span>
        )}
      </p>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
        {task.summaryPoints.length === 0 ? (
          <p className={styles.muted}>No summary points.</p>
        ) : (
          <ul className={styles.summaryList}>
            {task.summaryPoints.map((point, index) => (
              <li key={`${point.kind}-${index}`}>{summaryText(point)}</li>
            ))}
          </ul>
        )}
      </section>

      <HandoffPanel
        initialTask={task}
        initialRecipients={initialRecipients}
        recipientsNextCursor={recipientsNextCursor}
        initialConnection={initialConnection}
      />
    </div>
  );
}
