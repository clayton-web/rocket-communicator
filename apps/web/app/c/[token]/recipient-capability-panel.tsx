'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { components } from '@aicaa/contracts/schema';
import type { CapabilityAction } from '@aicaa/domain';
import {
  deriveAvailableRecipientActions,
  type RecipientUiAction,
} from '@/lib/capability/available-actions';
import {
  OUTCOME_OPTIONS,
  postCapabilityAction,
  publicErrorMessage,
  reloadCapabilityTask,
} from '@/lib/capability/client-api';
import styles from './recipient-capability.module.css';

type TaskDto = components['schemas']['Task'];
type TaskOutcomeType = components['schemas']['TaskOutcomeType'];

export interface RecipientCapabilityPanelProps {
  /** Passed only for API construction — never displayed. */
  token: string;
  initialTask: TaskDto;
  permittedActions: CapabilityAction[];
  expiresAt: string;
}

type PanelMode =
  | { kind: 'browse' }
  | { kind: 'confirm'; action: RecipientUiAction }
  | { kind: 'returned'; task: TaskDto }
  | { kind: 'workRequestSuccess'; message: string };

const ACTION_LABELS: Record<RecipientUiAction, string> = {
  mark_task_waiting: 'Mark waiting',
  resume_task: 'Resume',
  complete_task: 'Complete',
  add_task_note: 'Add note',
  request_clarification: 'Request clarification',
  return_task_to_owner: 'Return to owner',
  submit_work_request: 'Submit work request',
};

function formatInstant(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function summaryLabel(point: TaskDto['summaryPoints'][number]): string {
  return point.label || point.kind.replaceAll('_', ' ');
}

function summaryText(point: TaskDto['summaryPoints'][number]): string {
  if ('value' in point && typeof point.value === 'string') {
    return point.value;
  }
  return point.label;
}

export function RecipientCapabilityPanel({
  token,
  initialTask,
  permittedActions,
  expiresAt,
}: RecipientCapabilityPanelProps) {
  const [task, setTask] = useState(initialTask);
  const [mode, setMode] = useState<PanelMode>({ kind: 'browse' });
  const [banner, setBanner] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitGuard = useRef(false);
  const titleId = useId();

  const available =
    mode.kind === 'returned' ? [] : deriveAvailableRecipientActions(permittedActions, task.status);

  useEffect(() => {
    // Never persist the token outside of the React prop used for API calls.
    try {
      window.sessionStorage.removeItem('capabilityToken');
      window.localStorage.removeItem('capabilityToken');
    } catch {
      // ignore storage access failures
    }
  }, []);

  async function submitAction(action: RecipientUiAction, body: Record<string, unknown>) {
    if (submitGuard.current || submitting) {
      return;
    }
    submitGuard.current = true;
    setSubmitting(true);
    setBanner(null);

    try {
      const result = await postCapabilityAction({
        token,
        taskId: task.id,
        etag: task.etag,
        action,
        body,
      });

      if (!result.ok) {
        if (result.status === 412) {
          const reloaded = await reloadCapabilityTask({ token, taskId: task.id });
          if (reloaded.ok && 'task' in reloaded) {
            setTask(reloaded.task);
            setMode({ kind: 'browse' });
            setBanner({
              tone: 'info',
              text: publicErrorMessage(412, result.message),
            });
          } else if (!reloaded.ok) {
            setBanner({
              tone: 'error',
              text: publicErrorMessage(reloaded.status, reloaded.message),
            });
            if (reloaded.status === 401) {
              setMode({ kind: 'browse' });
            }
          } else {
            setBanner({
              tone: 'error',
              text: publicErrorMessage(412, result.message),
            });
          }
          return;
        }

        setBanner({
          tone: 'error',
          text: publicErrorMessage(result.status, result.message),
        });
        if (result.status === 401) {
          setMode({ kind: 'browse' });
        }
        return;
      }

      if (action === 'return_task_to_owner' && 'task' in result) {
        setTask(result.task);
        setMode({ kind: 'returned', task: result.task });
        setBanner(null);
        return;
      }

      if (action === 'submit_work_request' && 'workRequest' in result) {
        if (result.workRequest.task) {
          setTask(result.workRequest.task);
        }
        setMode({ kind: 'browse' });
        setBanner({
          tone: 'info',
          text: 'Work request submitted for owner review. No new task was created.',
        });
        return;
      }

      if ('task' in result) {
        setTask(result.task);
        setMode({ kind: 'browse' });
        setBanner({ tone: 'info', text: 'Saved.' });
      }
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }

  if (mode.kind === 'returned') {
    return (
      <main className={styles.page}>
        <h1>Returned to owner</h1>
        <p className={styles.lede}>
          Thanks. This assignment was returned to the owner. This link will no longer work.
        </p>
        {mode.task.notes && mode.task.notes.length > 0 ? (
          <section className={styles.section} aria-labelledby={`${titleId}-notes`}>
            <h2 id={`${titleId}-notes`}>Latest notes</h2>
            <ul className={styles.notes}>
              {mode.task.notes.slice(-3).map((note) => (
                <li key={note.id}>
                  <p className={styles.noteBody}>{note.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    );
  }

  const dueLabel = formatInstant(task.dueAt);
  const waitingLabel = formatInstant(task.waitingUntil);
  const expiresLabel = formatInstant(expiresAt);
  const intendedEmail = task.assignment?.intendedRecipientEmail;

  return (
    <main className={styles.page}>
      <h1>Assigned task</h1>
      <p className={styles.lede}>
        Review the details below, then confirm before submitting any update.
      </p>
      {intendedEmail ? (
        <p className={styles.meta}>
          This link was issued for work shared with {intendedEmail}. Having the link authorizes the
          allowed actions; it does not verify who is using it.
        </p>
      ) : null}
      <p className={styles.meta}>
        Status: <strong>{task.status.replaceAll('_', ' ')}</strong>
        {dueLabel ? ` · Due ${dueLabel}` : ''}
        {waitingLabel ? ` · Waiting until ${waitingLabel}` : ''}
        {expiresLabel ? ` · Link available until ${expiresLabel}` : ''}
      </p>

      <section className={styles.section} aria-labelledby={`${titleId}-summary`}>
        <h2 id={`${titleId}-summary`}>Instructions</h2>
        <ul className={styles.points}>
          {task.summaryPoints.map((point) => (
            <li key={point.id} className={styles.point}>
              <span className={styles.pointLabel}>{summaryLabel(point)}</span>
              {summaryText(point)}
            </li>
          ))}
        </ul>
      </section>

      {task.notes && task.notes.length > 0 ? (
        <section className={styles.section} aria-labelledby={`${titleId}-notes`}>
          <h2 id={`${titleId}-notes`}>Notes</h2>
          <ul className={styles.notes}>
            {task.notes.map((note) => (
              <li key={note.id}>
                <p className={styles.noteBody}>{note.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby={`${titleId}-actions`}>
        <h2 id={`${titleId}-actions`}>Actions</h2>
        {available.length === 0 ? (
          <p className={styles.hint}>No actions are available for this task right now.</p>
        ) : (
          <div className={styles.actions}>
            {available.map((action) => (
              <button
                key={action}
                type="button"
                className={action === 'return_task_to_owner' ? styles.danger : undefined}
                disabled={submitting}
                onClick={() => {
                  setBanner(null);
                  setMode({ kind: 'confirm', action });
                }}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}
      </section>

      {banner ? (
        <p
          role="status"
          aria-live="polite"
          className={`${styles.alert} ${banner.tone === 'error' ? styles.alertError : ''}`}
        >
          {banner.text}
        </p>
      ) : null}

      {mode.kind === 'confirm' ? (
        <ConfirmationDialog
          titleId={titleId}
          action={mode.action}
          submitting={submitting}
          onCancel={() => {
            if (!submitting) {
              setMode({ kind: 'browse' });
            }
          }}
          onSubmit={(body) => {
            void submitAction(mode.action, body);
          }}
        />
      ) : null}
    </main>
  );
}

function ConfirmationDialog({
  titleId,
  action,
  submitting,
  onCancel,
  onSubmit,
}: {
  titleId: string;
  action: RecipientUiAction;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [waitingUntil, setWaitingUntil] = useState('');
  const [reason, setReason] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [message, setMessage] = useState('');
  const [outcomeType, setOutcomeType] = useState<TaskOutcomeType>('completed');
  const [completeNote, setCompleteNote] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const headingId = `${titleId}-dialog`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    switch (action) {
      case 'mark_task_waiting':
        if (!waitingUntil) {
          return;
        }
        onSubmit({
          waitingUntil: new Date(waitingUntil).toISOString(),
          reason: reason.trim() || undefined,
        });
        return;
      case 'resume_task':
        onSubmit({});
        return;
      case 'complete_task':
        onSubmit({
          outcomeType,
          note: completeNote.trim() || undefined,
        });
        return;
      case 'add_task_note':
        if (!noteBody.trim()) {
          return;
        }
        onSubmit({ body: noteBody.trim() });
        return;
      case 'request_clarification':
        if (!message.trim()) {
          return;
        }
        onSubmit({ message: message.trim() });
        return;
      case 'return_task_to_owner':
        onSubmit({ note: returnNote.trim() || undefined });
        return;
      case 'submit_work_request':
        if (!message.trim()) {
          return;
        }
        onSubmit({ message: message.trim() });
        return;
      default:
        return;
    }
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <h2 id={headingId}>{ACTION_LABELS[action]}</h2>
        <DialogCopy action={action} />
        <form onSubmit={handleSubmit}>
          <DialogFields
            action={action}
            waitingUntil={waitingUntil}
            setWaitingUntil={setWaitingUntil}
            reason={reason}
            setReason={setReason}
            noteBody={noteBody}
            setNoteBody={setNoteBody}
            message={message}
            setMessage={setMessage}
            outcomeType={outcomeType}
            setOutcomeType={setOutcomeType}
            completeNote={completeNote}
            setCompleteNote={setCompleteNote}
            returnNote={returnNote}
            setReturnNote={setReturnNote}
          />
          <div className={styles.dialogActions}>
            <button type="button" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={action === 'return_task_to_owner' ? styles.danger : styles.primary}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DialogCopy({ action }: { action: RecipientUiAction }): ReactNode {
  switch (action) {
    case 'return_task_to_owner':
      return (
        <p className={styles.hint}>
          Returning this assignment ends your access. This link will stop working after you confirm.
        </p>
      );
    case 'submit_work_request':
      return (
        <p className={styles.hint}>
          This sends a typed request for the owner to review. It creates a pending suggestion, not a
          new assigned task.
        </p>
      );
    default:
      return (
        <p className={styles.hint}>
          Confirm to submit this update. Cancel leaves the task unchanged.
        </p>
      );
  }
}

function DialogFields(props: {
  action: RecipientUiAction;
  waitingUntil: string;
  setWaitingUntil: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  noteBody: string;
  setNoteBody: (value: string) => void;
  message: string;
  setMessage: (value: string) => void;
  outcomeType: TaskOutcomeType;
  setOutcomeType: (value: TaskOutcomeType) => void;
  completeNote: string;
  setCompleteNote: (value: string) => void;
  returnNote: string;
  setReturnNote: (value: string) => void;
}) {
  switch (props.action) {
    case 'mark_task_waiting':
      return (
        <>
          <div className={styles.field}>
            <label htmlFor="waiting-until">Waiting until</label>
            <input
              id="waiting-until"
              type="datetime-local"
              required
              value={props.waitingUntil}
              onChange={(event) => props.setWaitingUntil(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="waiting-reason">Reason (optional)</label>
            <input
              id="waiting-reason"
              type="text"
              maxLength={500}
              value={props.reason}
              onChange={(event) => props.setReason(event.target.value)}
            />
          </div>
        </>
      );
    case 'resume_task':
      return null;
    case 'complete_task':
      return (
        <>
          <div className={styles.field}>
            <label htmlFor="outcome-type">Outcome</label>
            <select
              id="outcome-type"
              value={props.outcomeType}
              onChange={(event) => props.setOutcomeType(event.target.value as TaskOutcomeType)}
            >
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="complete-note">Note (optional)</label>
            <textarea
              id="complete-note"
              maxLength={2000}
              rows={3}
              value={props.completeNote}
              onChange={(event) => props.setCompleteNote(event.target.value)}
            />
          </div>
        </>
      );
    case 'add_task_note':
      return (
        <div className={styles.field}>
          <label htmlFor="note-body">Note</label>
          <textarea
            id="note-body"
            required
            maxLength={2000}
            rows={4}
            value={props.noteBody}
            onChange={(event) => props.setNoteBody(event.target.value)}
          />
        </div>
      );
    case 'request_clarification':
    case 'submit_work_request':
      return (
        <div className={styles.field}>
          <label htmlFor="message-body">Message</label>
          <textarea
            id="message-body"
            required
            maxLength={2000}
            rows={4}
            value={props.message}
            onChange={(event) => props.setMessage(event.target.value)}
          />
        </div>
      );
    case 'return_task_to_owner':
      return (
        <div className={styles.field}>
          <label htmlFor="return-note">Note (optional)</label>
          <textarea
            id="return-note"
            maxLength={2000}
            rows={3}
            value={props.returnNote}
            onChange={(event) => props.setReturnNote(event.target.value)}
          />
        </div>
      );
    default:
      return null;
  }
}

export function CapabilityUnavailableView() {
  return (
    <main className={styles.page}>
      <h1>Link unavailable</h1>
      <p className={styles.lede}>
        This link is invalid or no longer available. If you still need access, ask the owner for a
        new link.
      </p>
    </main>
  );
}
