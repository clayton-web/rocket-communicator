'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from '../tasks.module.css';

export interface ReturnToOwnerDialogProps {
  open: boolean;
  recipientLabel: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for returning a permanently failed assignment to the Owner.
 *
 * Same dialog mechanics as handoff confirmation and reminder removal: focus capture and
 * restore, Escape, Tab wrap, checkbox gate. The copy is the only difference, and it must
 * not describe this as a retry or resend.
 */
export function ReturnToOwnerDialog({
  open,
  recipientLabel,
  submitting,
  onCancel,
  onConfirm,
}: ReturnToOwnerDialogProps) {
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
        <h2 id={titleId}>Return to owner</h2>
        <div id={descId}>
          <p>
            Delivery to <strong>{recipientLabel}</strong> failed. Returning this Task removes
            that failed assignment and leaves the Task with you, unassigned.
          </p>
          <p>The failed delivery will not be retried or sent again.</p>
          <p>After this, you can hand the Task off again when you are ready.</p>
        </div>
        <label className={styles.checkboxRow} htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            disabled={submitting}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>I confirm I want to return this Task to myself</span>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={!checked || submitting}
            aria-busy={submitting}
            onClick={handleConfirmClick}
          >
            Return to owner
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
