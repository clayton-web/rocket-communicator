'use client';

import { useCallback, useRef, useState } from 'react';
import type { components } from '@aicaa/contracts/schema';
import {
  deleteTaskReminder,
  fetchTaskReminder,
  putTaskReminder,
  type OwnerApiResult,
} from '@/lib/owner/api-client';
import { classifyReminderError, type ReminderOutcomeKind } from './public-errors';

type TaskReminderState = components['schemas']['TaskReminderState'];

export type ReminderBannerTone = 'info' | 'success' | 'error' | 'warning';

export interface ReminderBanner {
  readonly tone: ReminderBannerTone;
  readonly text: string;
  /** Distinguishes the outcome for tests and for callers that must not treat them alike. */
  readonly kind: 'success' | 'no_change' | 'resolved' | ReminderOutcomeKind;
}

export interface UseTaskReminderResult {
  readonly state: TaskReminderState;
  readonly submitting: boolean;
  readonly banner: ReminderBanner | null;
  readonly removalDialogOpen: boolean;
  save: (dueLocalDate: string) => Promise<void>;
  remove: () => Promise<void>;
  openRemovalDialog: () => void;
  closeRemovalDialog: () => void;
  clearBanner: () => void;
}

/*
 * Reminder mutation state for the Task detail panel (A8.6b; D112, D132).
 *
 * Three rules shape everything below.
 *
 * **The server owns the state.** Local reminder state is only ever replaced by a projection the
 * server returned. There is no optimistic update, no locally patched due date, and no inference that
 * a change applied because a request was sent. The ETag is adopted from the same response, so the
 * token and the state it describes can never come from different moments.
 *
 * **A refused or unanswered request is resolved by re-reading, never by retrying.** A `412` means
 * the schedule moved; a timeout means nobody knows. Both re-read and re-present. Neither resubmits:
 * a silent retry would repeat an action the Owner never reconfirmed, which for a due-date change
 * means opening a reminder cycle they did not ask for.
 *
 * **Ambiguity is reported as ambiguity.** After an unanswered mutation the panel compares what the
 * server now holds against what was requested and says which it is — applied, not applied, or
 * unknown because the re-read failed too. It never rounds any of those to "failed".
 */

/** Guard text shared by the two unknown-outcome paths so they cannot describe it differently. */
const REREAD_FAILED =
  'Rocket could not check the current reminder state either. Reload the Task to see where it stands.';

export function useTaskReminder(input: {
  taskId: string;
  initialState: TaskReminderState;
}): UseTaskReminderResult {
  const [state, setState] = useState<TaskReminderState>(input.initialState);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<ReminderBanner | null>(null);
  const [removalDialogOpen, setRemovalDialogOpen] = useState(false);

  /*
   * Synchronous double-submit guard.
   *
   * `submitting` drives `disabled` and `aria-busy`, but React state settles a render later, so two
   * activations inside one tick — a double click, or Enter and click together — would both pass a
   * state check. The ref closes that window before any request is sent.
   */
  const submitGuard = useRef(false);

  const adopt = useCallback((next: TaskReminderState) => {
    setState(next);
  }, []);

  /**
   * Re-read authoritative state after a refusal or a missing answer.
   *
   * Returns the server's state so the caller can compare it against what was requested, or null when
   * even the read failed — the one case where the panel genuinely cannot say what happened.
   */
  const reread = useCallback(async (): Promise<TaskReminderState | null> => {
    const result: OwnerApiResult<TaskReminderState> = await fetchTaskReminder(input.taskId);
    if (!result.ok) {
      return null;
    }
    adopt(result.data);
    return result.data;
  }, [adopt, input.taskId]);

  const save = useCallback(
    async (dueLocalDate: string) => {
      if (submitGuard.current) {
        return;
      }
      submitGuard.current = true;
      setSubmitting(true);
      setBanner(null);

      const previousDueLocalDate = state.dueLocalDate ?? null;
      const previousEtag = state.etag;

      try {
        const result = await putTaskReminder({
          taskId: input.taskId,
          dueLocalDate,
          ifMatch: previousEtag,
        });

        if (result.ok) {
          adopt(result.data);
          /*
           * The server distinguishes a real change from an immaterial repeat by returning the same
           * ETag and writing nothing (D104). Reporting both as "saved" would tell an Owner a new
           * cycle began when none did.
           */
          const unchanged =
            result.data.etag === previousEtag &&
            (result.data.dueLocalDate ?? null) === previousDueLocalDate;
          setBanner(
            unchanged
              ? {
                  tone: 'info',
                  kind: 'no_change',
                  text: 'That is already this Task’s due date, so nothing changed.',
                }
              : {
                  tone: 'success',
                  kind: 'success',
                  text: 'Due date saved. Reminder scheduling is updated; no reminder has been sent by saving it.',
                },
          );
          return;
        }

        const outcome = classifyReminderError(result.error);
        if (!outcome.reread) {
          setBanner({ tone: 'error', kind: outcome.kind, text: outcome.message });
          return;
        }

        const authoritative = await reread();
        if (authoritative === null) {
          setBanner({
            tone: 'warning',
            kind: outcome.kind,
            text: `${outcome.message} ${REREAD_FAILED}`,
          });
          return;
        }

        if (outcome.kind === 'ambiguous') {
          const applied = (authoritative.dueLocalDate ?? null) === dueLocalDate;
          setBanner({
            tone: 'warning',
            kind: 'ambiguous',
            text: applied
              ? 'The request did not get an answer, but this Task’s due date now matches what you asked for. The current state is shown below.'
              : 'The request did not get an answer, and this Task’s due date has not changed. The current state is shown below; submit again if you still want the change.',
          });
          return;
        }

        setBanner({
          tone: 'warning',
          kind: outcome.kind,
          text: `${outcome.message} Review it below before submitting again.`,
        });
      } finally {
        setSubmitting(false);
        submitGuard.current = false;
      }
    },
    [adopt, input.taskId, reread, state.dueLocalDate, state.etag],
  );

  const remove = useCallback(async () => {
    if (submitGuard.current) {
      return;
    }
    submitGuard.current = true;
    setSubmitting(true);
    setBanner(null);

    const previousEtag = state.etag;

    try {
      const result = await deleteTaskReminder({ taskId: input.taskId, ifMatch: previousEtag });

      if (result.ok) {
        adopt(result.data);
        setRemovalDialogOpen(false);
        setBanner({
          tone: 'success',
          kind: 'success',
          text: 'Due date removed. Reminders for this Task have stopped, and none will be scheduled until you set a due date again.',
        });
        return;
      }

      const outcome = classifyReminderError(result.error);
      if (!outcome.reread) {
        setRemovalDialogOpen(false);
        setBanner({ tone: 'error', kind: outcome.kind, text: outcome.message });
        return;
      }

      const authoritative = await reread();
      setRemovalDialogOpen(false);
      if (authoritative === null) {
        setBanner({
          tone: 'warning',
          kind: outcome.kind,
          text: `${outcome.message} ${REREAD_FAILED}`,
        });
        return;
      }

      if (outcome.kind === 'ambiguous') {
        const removed = (authoritative.dueLocalDate ?? null) === null;
        setBanner({
          tone: 'warning',
          kind: 'ambiguous',
          text: removed
            ? 'The request did not get an answer, but this Task no longer has a due date. The current state is shown below.'
            : 'The request did not get an answer, and this Task still has a due date. The current state is shown below; remove it again if you still want to.',
        });
        return;
      }

      setBanner({
        tone: 'warning',
        kind: outcome.kind,
        text: `${outcome.message} Review it below before removing again.`,
      });
    } finally {
      setSubmitting(false);
      submitGuard.current = false;
    }
  }, [adopt, input.taskId, reread, state.etag]);

  return {
    state,
    submitting,
    banner,
    removalDialogOpen,
    save,
    remove,
    openRemovalDialog: () => setRemovalDialogOpen(true),
    closeRemovalDialog: () => setRemovalDialogOpen(false),
    clearBanner: () => setBanner(null),
  };
}
