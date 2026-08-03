import type { components } from '@aicaa/contracts/schema';
import type { StatusTone } from '@/lib/presentation/task-status';

export type ReminderStopReason = NonNullable<
  components['schemas']['TaskReminderState']['stopReason']
>;

/**
 * The three stop reasons that raise Owner attention, in Owner-facing words.
 *
 * Shared deliberately. `/attention` (A8.6a) tells an Owner *that* a schedule stopped and sends them
 * to the Task; the Task panel (A8.6b) tells them what to do about it. If those two surfaces
 * described the same stop in different words, the Owner would reasonably wonder whether they were
 * looking at two different problems — so the sentence they carry is one constant, imported by both,
 * and a test asserts the Task page renders exactly what the list promised.
 *
 * The other three contracted stop reasons — `task_completed`, `task_dismissed`, `due_date_removed` —
 * are not here. They are ordinary endings rather than conditions needing a decision, they never
 * raise attention, and the two surfaces genuinely should say different things about them: the
 * Attention list cannot explain a schedule that should not be on it, while the Task page can say
 * plainly that reminders stopped because the Task was completed.
 *
 * The ambiguity wording is load-bearing (D129). Rocket does not know a reminder was missed; it knows
 * it could not confirm delivery, and those are different facts. "The Recipient did not receive it"
 * would send an Owner to re-send something that may already have arrived twice.
 */
export interface StopReasonCopy {
  readonly badge: string;
  readonly badgeTone: StatusTone;
  readonly headline: string;
  readonly explanation: string;
}

export const ATTENTION_STOP_REASON_COPY: Readonly<
  Record<
    'overdue_ceiling_reached' | 'permanent_delivery_failure' | 'repeated_ambiguous_outcomes',
    StopReasonCopy
  >
> = {
  overdue_ceiling_reached: {
    badge: 'Reminders finished',
    badgeTone: 'caution',
    headline: 'Reminders have finished for this Task.',
    explanation:
      'Rocket sent every daily reminder it will send for this due date and stopped. It will not start again on its own.',
  },
  permanent_delivery_failure: {
    badge: 'Reminders stopped',
    badgeTone: 'critical',
    headline: 'Reminders stopped after a delivery failure.',
    explanation:
      'A reminder could not be delivered, so Rocket stopped rather than continuing to try. Nothing further will be sent for this Task.',
  },
  repeated_ambiguous_outcomes: {
    badge: 'Reminders stopped',
    badgeTone: 'critical',
    headline: 'Reminders stopped because delivery could not be confirmed.',
    explanation:
      'Rocket could not confirm that recent reminders were delivered, so it stopped. The Recipient may or may not have received them.',
  },
};
