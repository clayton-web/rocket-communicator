'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { components } from '@aicaa/contracts/schema';
import type { TaskStatus } from '@aicaa/domain';
import { OWNER_DISPLAY_TIME_ZONE } from '@/lib/presentation/datetime';
import { dueDateProblem } from '@/lib/reminders/due-date';
import { useTaskReminder } from '@/lib/reminders/client/use-task-reminder';
import {
  REMINDER_DUE_DATE_TERM,
  restartsReminderCycle,
  toOwnerReminderView,
} from '@/lib/reminders/presentation';
import { StatusBadge } from '../../_components/status-badge';
import { ReminderRemovalDialog } from './reminder-removal-dialog';
import styles from '../tasks.module.css';

type TaskReminderState = components['schemas']['TaskReminderState'];

function bannerClass(tone: 'info' | 'success' | 'error' | 'warning'): string {
  switch (tone) {
    case 'success':
      return `${styles.banner} ${styles.bannerSuccess}`;
    case 'error':
      return `${styles.banner} ${styles.bannerError}`;
    case 'warning':
      return `${styles.banner} ${styles.bannerWarning}`;
    default:
      return `${styles.banner} ${styles.bannerInfo}`;
  }
}

/**
 * Task-level reminder status and repair controls (A8.6b; D104, D107, D108).
 *
 * The client island of an otherwise server-rendered Task page. It receives the authoritative
 * reminder projection the page already loaded, so the panel is correct on first paint with no
 * request of its own, and it never polls or refreshes itself: what it shows is what the server said
 * when the page was rendered, plus whatever a mutation returned since.
 *
 * The view model is recomputed from state on every render rather than stored, so there is exactly
 * one description of a given reminder state and no way for a stale copy to survive a mutation.
 *
 * Reminder timing is not editable here and never will be from this panel. 09:00 organization-local,
 * one advance reminder, daily overdue reminders, and the fourteen-delivery ceiling are policy
 * (D103, D106) rather than preferences, so the only control is the due date they are derived from.
 */
export function ReminderPanel({
  taskId,
  taskStatus,
  initialReminder,
}: {
  taskId: string;
  taskStatus: TaskStatus;
  initialReminder: TaskReminderState;
}) {
  const reminder = useTaskReminder({ taskId, initialState: initialReminder });
  const view = useMemo(
    () => toOwnerReminderView(reminder.state, taskStatus),
    [reminder.state, taskStatus],
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const dateInputId = useId();
  const dateHelpId = useId();
  const disclosureId = useId();
  const lockedReasonId = useId();
  const removeButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * The input follows the server until the Owner types.
   *
   * `draft === null` means untouched, so a mutation that returns a different date — including one
   * applied elsewhere and discovered by a stale-token re-read — is reflected immediately. Once the
   * Owner has typed, their entry is preserved across an ambiguous or refused submission so a
   * transport failure does not discard what they were trying to do.
   */
  const value = draft ?? view.dueDateValue;
  const disclose = value !== '' && restartsReminderCycle(reminder.state, value);
  const isFirstDueDate = view.dueDateValue === '';

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = dueDateProblem(value);
    if (problem !== null) {
      setInvalid(problem);
      return;
    }
    setInvalid(null);
    void reminder.save(value);
  }

  return (
    <section className={styles.section} aria-labelledby="reminder-heading">
      <h2 id="reminder-heading">Reminders</h2>

      <div className={styles.card}>
        <p className={styles.itemBadges}>
          <StatusBadge label={view.badge} tone={view.badgeTone} />
        </p>
        <p className={styles.noteBody}>{view.headline}</p>
        <p className={styles.muted}>{view.explanation}</p>

        {view.dueDateText ? (
          <dl className={styles.dateList}>
            <div className={styles.dateRow}>
              <dt className={styles.dateTerm}>{REMINDER_DUE_DATE_TERM}</dt>
              <dd className={styles.dateValue}>{view.dueDateText}</dd>
            </div>
            {view.facts.map((fact) => (
              <div className={styles.dateRow} key={fact.term}>
                <dt className={styles.dateTerm}>{fact.term}</dt>
                <dd className={styles.dateValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {/*
       * Progress and result share one polite live region so a screen reader hears a single,
       * ordered account of what happened rather than two announcements racing. Errors are
       * `role="alert"`, which is assertive by definition.
       */}
      <div aria-live="polite">
        {reminder.submitting ? (
          <p className={styles.muted} role="status">
            Saving your change. The outcome is not known yet.
          </p>
        ) : null}
        {reminder.banner && reminder.banner.tone !== 'error' ? (
          <p className={bannerClass(reminder.banner.tone)}>{reminder.banner.text}</p>
        ) : null}
      </div>
      {reminder.banner && reminder.banner.tone === 'error' ? (
        <p className={bannerClass('error')} role="alert">
          {reminder.banner.text}
        </p>
      ) : null}

      {view.editability.editable ? (
        <form onSubmit={onSubmit} noValidate>
          <div className={styles.field}>
            <label htmlFor={dateInputId}>
              {isFirstDueDate
                ? `Set a ${REMINDER_DUE_DATE_TERM.toLowerCase()}`
                : REMINDER_DUE_DATE_TERM}
            </label>
            <input
              id={dateInputId}
              type="date"
              value={value}
              disabled={reminder.submitting}
              aria-describedby={disclose ? `${dateHelpId} ${disclosureId}` : dateHelpId}
              aria-invalid={invalid !== null}
              onChange={(event) => {
                setDraft(event.target.value);
                setInvalid(null);
              }}
            />
            <p id={dateHelpId} className={styles.muted}>
              Dates are {OWNER_DISPLAY_TIME_ZONE.replace('_', ' ')} calendar dates. Reminders go out
              at 9:00 in that timezone; you cannot choose the time.
            </p>
            {invalid ? (
              <p className={bannerClass('error')} role="alert">
                {invalid}
              </p>
            ) : null}
          </div>

          {/*
           * D104 disclosure, shown before the Owner commits rather than reported afterwards.
           *
           * Only when the save really will restart the cycle: not for a first due date, and not for
           * re-saving the same date on a live schedule, where the server writes nothing. Promising a
           * restart that does not happen is as misleading as hiding one that does.
           */}
          {disclose ? (
            <p id={disclosureId} className={bannerClass('warning')}>
              Saving this starts a new reminder cycle. The count of overdue reminders sent goes back
              to zero, and the reminder before the due date and the daily overdue reminders are
              worked out again from the new date. What was already sent stays on the record.
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.button}
              disabled={reminder.submitting}
              aria-busy={reminder.submitting}
            >
              {isFirstDueDate ? 'Set reminder due date' : 'Save reminder due date'}
            </button>
            {view.editability.removable ? (
              <button
                ref={removeButtonRef}
                type="button"
                className={styles.buttonSecondary}
                disabled={reminder.submitting}
                onClick={reminder.openRemovalDialog}
              >
                Remove reminder due date
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          {/*
           * Not a disabled button with no explanation. The reason is a `status` region rather than
           * a tooltip so assistive technology reaches it, and the control is absent rather than
           * present-and-dead, because the server would refuse it.
           */}
          <p id={lockedReasonId} className={styles.muted} role="status">
            {view.editability.lockedReason}
          </p>
          {view.editability.removable ? (
            <div className={styles.actions}>
              <button
                ref={removeButtonRef}
                type="button"
                className={styles.buttonSecondary}
                disabled={reminder.submitting}
                aria-describedby={lockedReasonId}
                onClick={reminder.openRemovalDialog}
              >
                Remove reminder due date
              </button>
            </div>
          ) : null}
        </>
      )}

      {reminder.removalDialogOpen ? (
        <ReminderRemovalDialog
          open
          dueDateText={view.dueDateText ?? ''}
          submitting={reminder.submitting}
          onCancel={() => {
            reminder.closeRemovalDialog();
            removeButtonRef.current?.focus();
          }}
          onConfirm={() => void reminder.remove()}
        />
      ) : null}
    </section>
  );
}
