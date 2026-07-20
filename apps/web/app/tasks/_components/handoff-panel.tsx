'use client';

import { useId, useRef } from 'react';
import type { components } from '@aicaa/contracts/schema';
import { useTaskHandoff } from '@/lib/handoff/client/use-task-handoff';
import { deliveryPathLabel } from '@/lib/handoff/client/delivery-copy';
import { HandoffConfirmationDialog } from './handoff-confirmation-dialog';
import styles from '../tasks.module.css';

type TaskDto = components['schemas']['Task'];

function summaryText(point: TaskDto['summaryPoints'][number]): string {
  if ('value' in point && typeof point.value === 'string') {
    return point.value;
  }
  return point.label;
}

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

type RecipientDto = components['schemas']['Recipient'];
type GmailConnectionDto = components['schemas']['GmailConnection'];

export function HandoffPanel({
  initialTask,
  initialRecipients,
  recipientsNextCursor,
  initialConnection,
}: {
  initialTask: TaskDto;
  initialRecipients: RecipientDto[];
  recipientsNextCursor: string | null;
  initialConnection: GmailConnectionDto;
}) {
  const handoff = useTaskHandoff({
    initialTask,
    initialRecipients,
    recipientsNextCursor,
    initialConnection,
  });
  const recipientSelectId = useId();
  const handoffButtonRef = useRef<HTMLButtonElement>(null);
  const assigned = Boolean(handoff.task.assignment);

  const recipientLabel = handoff.selectedRecipient
    ? `${handoff.selectedRecipient.displayName} (${handoff.selectedRecipient.email})`
    : 'the selected Recipient';

  const needsReconsent =
    handoff.connection?.status === 'connected' &&
    (handoff.connection.requiresSendReconsent === true || handoff.connection.canSend === false);

  const notConnected =
    !handoff.connectionLoading &&
    (handoff.connection == null || handoff.connection.status !== 'connected');

  return (
    <section className={styles.section} aria-labelledby="handoff-heading">
      <h2 id="handoff-heading">Handoff</h2>

      {handoff.banner ? (
        <div
          className={bannerClass(handoff.banner.tone)}
          role={handoff.banner.tone === 'error' ? 'alert' : 'status'}
          aria-live={handoff.banner.tone === 'error' ? undefined : 'polite'}
        >
          {handoff.banner.text}
        </div>
      ) : null}

      {handoff.lastSuccess || assigned ? (
        <div className={styles.card} role="status" aria-live="polite">
          <p className={styles.muted}>
            {handoff.task.assignment
              ? `Assigned to ${handoff.task.assignment.intendedRecipientEmail}`
              : 'Assignment sent.'}
            {handoff.task.assignment?.deliveryStatus ? (
              <span className={styles.statusPill}>
                {handoff.task.assignment.deliveryStatus === 'sent'
                  ? 'Sent'
                  : handoff.task.assignment.deliveryStatus}
              </span>
            ) : null}
          </p>
          {handoff.lastSuccess ? (
            <p className={styles.muted}>
              Delivery: {deliveryPathLabel(handoff.lastSuccess.deliveryPath)} · Status: Sent
            </p>
          ) : null}
          {handoff.lastSuccess?.capabilityId ? (
            <p className={styles.srOnly}>Capability reference recorded.</p>
          ) : null}
        </div>
      ) : null}

      {(needsReconsent ||
        notConnected ||
        handoff.pending?.lastOutcomeCategory === 'reconsent_required' ||
        handoff.pending?.lastOutcomeCategory === 'not_connected') &&
      !assigned ? (
        <div className={styles.card}>
          <p className={styles.muted}>
            {notConnected
              ? 'Connect Gmail to send this handoff.'
              : 'Gmail send permission is missing or expired. Grant send access, then retry this handoff.'}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={handoff.startReconsent}
              disabled={handoff.submitting}
            >
              {notConnected ? 'Connect Gmail' : 'Grant Gmail send access'}
            </button>
          </div>
        </div>
      ) : null}

      {!assigned && !handoff.lastSuccess ? (
        <>
          <p className={styles.muted}>{handoff.predictedExplanation}</p>
          <p className={styles.srOnly}>Expected delivery mode: {handoff.predictedPathLabel}</p>

          <div className={styles.field}>
            <label htmlFor={recipientSelectId}>Recipient</label>
            <select
              id={recipientSelectId}
              value={handoff.selectedRecipientId}
              disabled={
                handoff.recipientsLoading ||
                handoff.submitting ||
                (handoff.pending != null &&
                  [
                    'in_progress',
                    'ambiguous',
                    'retryable_failure',
                    'permanent_failure',
                    'preparation_failure',
                    'success',
                    'replay_success',
                    'reconsent_required',
                    'not_connected',
                  ].includes(handoff.pending.lastOutcomeCategory ?? ''))
              }
              onChange={(event) => handoff.setSelectedRecipientId(event.target.value)}
            >
              <option value="">Select a Recipient…</option>
              {handoff.recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.displayName} — {recipient.email}
                </option>
              ))}
            </select>
            {handoff.recipientsNextCursor ? (
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => void handoff.loadMoreRecipients()}
                disabled={handoff.recipientsLoading}
              >
                Load more
              </button>
            ) : null}
            {handoff.handoffDisabledReason ? (
              <p className={styles.muted} role="status">
                {handoff.handoffDisabledReason}
              </p>
            ) : null}
          </div>

          <div className={styles.actions}>
            {handoff.canShowHandoffAction && !handoff.pending?.lastOutcomeCategory ? (
              <button
                ref={handoffButtonRef}
                type="button"
                className={styles.button}
                disabled={!handoff.selectedRecipientId || handoff.submitting}
                onClick={handoff.openDialog}
              >
                Hand off…
              </button>
            ) : null}

            {handoff.showCheckStatus ? (
              <button
                type="button"
                className={styles.button}
                disabled={handoff.submitting}
                aria-busy={handoff.submitting}
                onClick={() => void handoff.retryOrCheckHandoff()}
              >
                Check handoff status
              </button>
            ) : null}

            {handoff.showRetryHandoff && !handoff.showCheckStatus ? (
              <button
                type="button"
                className={styles.button}
                disabled={handoff.submitting}
                aria-busy={handoff.submitting}
                onClick={() => void handoff.retryOrCheckHandoff()}
              >
                Retry handoff
              </button>
            ) : null}

            {handoff.pending?.lastOutcomeCategory === 'permanent_failure' ||
            handoff.pending?.lastOutcomeCategory === 'preparation_failure' ? (
              <p className={styles.muted} role="status">
                This handoff operation remains on the server. Clearing browser storage does not
                cancel it. If it stays unresolved, escalate through your support process.
              </p>
            ) : null}

            {handoff.pending?.lastOutcomeCategory === 'ambiguous' ? (
              <p className={styles.muted} role="status">
                Do not start a new handoff. Use Check handoff status with the same operation. If it
                remains unresolved, escalate through your support process.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {handoff.dialogOpen ? (
        <HandoffConfirmationDialog
          open
          recipientLabel={recipientLabel}
          deliveryExplanation={handoff.predictedExplanation}
          submitting={handoff.submitting}
          onCancel={() => {
            handoff.closeDialog();
            handoffButtonRef.current?.focus();
          }}
          onConfirm={() => void handoff.confirmHandoff()}
        />
      ) : null}
    </section>
  );
}
