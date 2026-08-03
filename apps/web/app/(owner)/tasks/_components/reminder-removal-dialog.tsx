'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from '../tasks.module.css';

export interface ReminderRemovalDialogProps {
  open: boolean;
  dueDateText: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for removing a Task's due date and stopping its reminders (A8.6b).
 *
 * Structurally the same dialog as the handoff confirmation — same focus capture and restore, same
 * Escape and Tab handling, same checkbox gate — because a second dialog that behaved differently
 * would be a second thing for an Owner to learn and a second thing to get wrong for assistive
 * technology. What differs is the copy, and only where the truth differs.
 *
 * Removal is destructive to automation but not to history, and the wording holds that line. It does
 * not offer to unsend: any reminder already delivered has been delivered, and nothing on this screen
 * can recall it.
 */
export function ReminderRemovalDialog({
  open,
  dueDateText,
  submitting,
  onCancel,
  onConfirm,
}: ReminderRemovalDialogProps) {
  const titleId = useId();
  const descId = useId();
  const checkboxId = useId();
  const [checked, setChecked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!submitting) {
          onCancel();
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const nodes = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute('disabled'));
      if (nodes.length === 0) {
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel, submitting]);

  // Unmount when closed so the confirmation checkbox resets without an effect setState.
  if (!open) {
    return null;
  }

  function handleConfirmClick() {
    if (!checked || submitting) {
      return;
    }
    onConfirm();
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>Remove reminder due date</h2>
        <div id={descId}>
          <p>
            This Task’s reminder due date of <strong>{dueDateText}</strong> will be removed.
          </p>
          <p>
            The current reminder cycle will stop. No further reminders will be scheduled or sent for
            this Task unless you set a due date again.
          </p>
          <p>
            Reminders that were already sent stay sent — removing the due date cannot recall an
            email that has left. The record of what was scheduled and delivered remains on the Task.
          </p>
        </div>
        <label className={styles.checkboxRow} htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            disabled={submitting}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>I confirm I want to remove this reminder due date and stop its reminders</span>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!checked || submitting}
            aria-busy={submitting}
            onClick={handleConfirmClick}
          >
            Remove reminder due date
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
