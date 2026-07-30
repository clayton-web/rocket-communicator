import type { components } from '@aicaa/contracts/schema';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/presentation/datetime';
import { noteBoundNotice } from '@/lib/presentation/task-notes';
import { deriveTaskTitle, summaryPointText } from '@/lib/presentation/task-title';
import {
  assignmentLabel,
  deliveryStatusLabel,
  deliveryTone,
  taskStatusLabel,
  taskStatusTone,
  taskUrgencyLabel,
  urgencyTone,
} from '@/lib/presentation/task-status';
import { EmptyState } from '../../_components/empty-state';
import { PageHeader } from '../../_components/page-header';
import { StatusBadge } from '../../_components/status-badge';
import { HandoffPanel } from './handoff-panel';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];
type RecipientDto = components['schemas']['Recipient'];
type GmailConnectionDto = components['schemas']['GmailConnection'];
type TaskNoteDto = components['schemas']['TaskNote'];
type ActionAttributionDto = components['schemas']['ActionAttribution'];

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

function NoteItem({ note }: { note: TaskNoteDto }) {
  return (
    <li className={styles.card}>
      <p className={styles.noteBody}>{note.body}</p>
      <p className={styles.meta}>
        {attributionLabel(note.attribution)}
        <span className={styles.statusPill}>{formatOwnerDateTime(note.createdAt)}</span>
      </p>
    </li>
  );
}

/**
 * Owner Task detail (P1.4).
 *
 * A server component since P1.4. It holds no state and reacts to nothing — only `HandoffPanel`
 * does, and that stays a client component. Rendering on the server matters for more than bundle
 * size here: timestamps are formatted in the Owner organization's timezone, and doing that on
 * the client would format against whatever timezone the browser happens to be in and produce a
 * hydration mismatch (D117).
 *
 * The heading is the Task's derived title rather than the literal word "Task". A page whose
 * `<h1>` is "Task" tells the Owner nothing, and reads identically for every Task in browser
 * history, in a bookmark, and to a screen reader.
 */
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
  const urgency = task.derivedUrgency ?? null;
  const urgencyText = taskUrgencyLabel(urgency);
  const delivery = task.assignment?.deliveryStatus ?? null;
  const deliveryText = deliveryStatusLabel(delivery);

  // `null` below the query limit; see `lib/presentation/task-notes.ts` for the wording rule.
  const noteNotice = noteBoundNotice(notes.length);

  return (
    // The Owner shell layout supplies the container, landmark, and navigation.
    <>
      <PageHeader
        title={deriveTaskTitle(task)}
        meta={
          <>
            <StatusBadge label={taskStatusLabel(task.status)} tone={taskStatusTone(task.status)} />
            {urgencyText && urgency ? (
              <StatusBadge label={urgencyText} tone={urgencyTone(urgency)} />
            ) : null}
            <StatusBadge label={assignmentLabel(Boolean(task.assignment))} />
            {deliveryText && delivery ? (
              <StatusBadge label={deliveryText} tone={deliveryTone(delivery)} />
            ) : null}
          </>
        }
      />

      {task.dueAt || task.waitingUntil ? (
        <dl className={styles.dateList}>
          {task.dueAt ? (
            <div className={styles.dateRow}>
              <dt className={styles.dateTerm}>Due date</dt>
              <dd className={styles.dateValue}>{formatOwnerDate(task.dueAt)}</dd>
            </div>
          ) : null}
          {task.waitingUntil ? (
            <div className={styles.dateRow}>
              <dt className={styles.dateTerm}>Waiting until</dt>
              <dd className={styles.dateValue}>{formatOwnerDate(task.waitingUntil)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading">Summary</h2>
        {task.summaryPoints.length === 0 ? (
          <p className={styles.muted}>No summary points.</p>
        ) : (
          <ul className={styles.summaryList}>
            {task.summaryPoints.map((point, index) => (
              <li key={`${point.kind}-${index}`}>{summaryPointText(point)}</li>
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
              <span className={styles.statusPill}>{formatOwnerDateTime(outcome.completedAt)}</span>
            </p>
            <p className={styles.meta}>{attributionLabel(outcome.attribution)}</p>
            {outcome.note ? <p className={styles.noteBody}>{outcome.note}</p> : null}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="notes-heading">
        <h2 id="notes-heading">Notes</h2>
        {notes.length === 0 ? (
          <EmptyState
            message="No notes yet."
            explanation="Notes added by you, or by a Recipient through a capability link, will appear here."
          />
        ) : (
          <>
            <ul className={styles.notesList}>
              {notes.map((note) => (
                <NoteItem key={note.id} note={note} />
              ))}
            </ul>
            {noteNotice ? <p className={styles.meta}>{noteNotice}</p> : null}
          </>
        )}
      </section>

      <HandoffPanel
        initialTask={task}
        initialRecipients={initialRecipients}
        recipientsNextCursor={recipientsNextCursor}
        initialConnection={initialConnection}
      />
    </>
  );
}
