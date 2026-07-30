'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from '../tasks.module.css';

export interface HandoffConfirmationDialogProps {
  open: boolean;
  recipientLabel: string;
  deliveryExplanation: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function HandoffConfirmationDialog({
  open,
  recipientLabel,
  deliveryExplanation,
  submitting,
  onCancel,
  onConfirm,
}: HandoffConfirmationDialogProps) {
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
    const root = dialogRef.current;
    const focusable = root?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Unmount when closed so the confirmation checkbox resets without an effect setState.

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

  if (!open) {
    return null;
  }

  function handleConfirmClick() {
    if (!checked || submitting) {
      return;
    }
    onConfirm();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Prevent Enter on non-button controls from implying confirm without the checkbox path.
    if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      // checkbox Enter toggles; do not submit
    }
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
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id={titleId}>Confirm handoff</h2>
        <div id={descId}>
          <p>
            You are handing off this Task to <strong>{recipientLabel}</strong>.
          </p>
          <p>{deliveryExplanation}</p>
          <p>
            The Recipient will receive a secure action link. The link becomes usable only after
            delivery succeeds. This action cannot be silently undone from this screen.
          </p>
          <p>
            Follow-up and reminder behaviour belongs to the assignment workflow later. Reminders are
            not scheduled by this confirmation.
          </p>
          <p>
            If this is a Gmail forward, copies in Gmail remain subject to your organization’s Gmail
            retention settings and are not deleted by this application.
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
          <span>I confirm I want to hand off this Task</span>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!checked || submitting}
            aria-busy={submitting}
            onClick={handleConfirmClick}
          >
            Confirm handoff
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
