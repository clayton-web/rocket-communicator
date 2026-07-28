'use client';

import Link from 'next/link';
import type { components } from '@aicaa/contracts/schema';
import { HandoffPanel } from './handoff-panel';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type GmailConnectionDto = components['schemas']['GmailConnection'];
type TaskNoteDto = components['schemas']['TaskNote'];
type ActionAttributionDto = components['schemas']['ActionAttribution'];

function summaryText(point: TaskDto['summaryPoints'][number]): string {
  if ('value' in point && typeof point.value === 'string') {
    return point.value;
  }
  return point.label;
}

/** Privacy-safe attribution line for Owner UI (D052). Never renders capability tokens. */
function attributionLabel(attribution: ActionAttributionDto): string {
  if (attribution.kind === 'owner') {
    return 'Owner';
  }
  const capability = attribution.capability;
  const label = capability?.attributionLabel?.trim();
  if (label) {
    return label;
  }
  if (capability?.action) {
    return `Capability action (${capability.action})`;
  }
  return 'Capability action';
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
}

function NoteItem({ note }: { note: TaskNoteDto }) {
  return (
    <li className={styles.card}>
      <p className={styles.noteBody}>{note.body}</p>
      <p className={styles.meta}>
        {attributionLabel(note.attribution)}
        <span className={styles.statusPill}>{formatTimestamp(note.createdAt)}</span>
      </p>
    </li>
  );
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
  const outcome = task.outcome;
  const notes = task.notes ?? [];

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

      {outcome ? (
        <section className={styles.section} aria-labelledby="outcome-heading">
          <h2 id="outcome-heading">Completion</h2>
          <div className={styles.card} role="status">
            <p className={styles.muted}>
              Outcome: {outcome.outcomeType}
              <span className={styles.statusPill}>{formatTimestamp(outcome.completedAt)}</span>
            </p>
            <p className={styles.meta}>{attributionLabel(outcome.attribution)}</p>
            {outcome.note ? <p className={styles.noteBody}>{outcome.note}</p> : null}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes</h2>
        {notes.length === 0 ? (
          <p className={styles.muted} role="status">
            No notes yet.
          </p>
        ) : (
          <ul className={styles.notesList}>
            {notes.map((note) => (
              <NoteItem key={note.id} note={note} />
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
