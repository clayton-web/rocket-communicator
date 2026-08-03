import type { OwnerApiError } from '@/lib/owner/api-client';

/**
 * Reminder mutation outcomes, in the categories the panel must keep apart (A8.6b; D112, D132).
 *
 * The shared parser in `lib/handoff/client/public-errors.ts` already turns an `ErrorResponse` into a
 * validated code and a transport failure into an ambiguous result, and this reuses both. What it
 * does not reuse is the copy: that parser speaks about handoffs and Gmail delivery, and telling an
 * Owner that "Gmail did not accept the message" when they changed a due date would be worse than
 * saying nothing. Only the machine-readable `status` and `code` cross this boundary.
 *
 * The categories exist because collapsing them is the failure mode D112 was written against:
 *
 * - `stale` is not a failure. The Owner's change was refused because the schedule moved, and the
 *   panel must show what it moved to before the Owner decides again.
 * - `ambiguous` is not a failure either. No answer arrived, so the request may or may not have
 *   applied, and only an authoritative re-read can say.
 * - `conflict` is a definite refusal that no retry will fix.
 *
 * `precondition_missing` (428) is listed for completeness and is a defect, not a user condition: the
 * panel always sends `If-Match`, and a test proves the UI cannot reach it.
 */
export type ReminderOutcomeKind =
  | 'validation'
  | 'conflict'
  | 'stale'
  | 'precondition_missing'
  | 'not_found'
  | 'unauthorized'
  | 'ambiguous'
  | 'unknown';

export interface ReminderErrorOutcome {
  readonly kind: ReminderOutcomeKind;
  readonly message: string;
  /**
   * Whether the panel must re-read the reminder resource before saying anything final.
   *
   * True exactly for the two cases where the displayed state may no longer be the server's:
   * a refused precondition, and a request with no answer.
   */
  readonly reread: boolean;
}

export function classifyReminderError(error: OwnerApiError): ReminderErrorOutcome {
  // No response at all: a mutation's effect is genuinely unknown until re-read (D132).
  if (error.status === 0) {
    return {
      kind: 'ambiguous',
      message:
        'The request did not get an answer, so this change may or may not have been saved. Rocket is checking the current reminder state.',
      reread: true,
    };
  }

  switch (error.code) {
    case 'PRECONDITION_FAILED':
      return {
        kind: 'stale',
        message:
          'This Task’s reminder changed somewhere else, so your change was not applied to it. Rocket is loading the current reminder state.',
        reread: true,
      };
    case 'PRECONDITION_REQUIRED':
      return {
        kind: 'precondition_missing',
        message:
          'Rocket could not confirm which version of the reminder was being changed, so nothing was saved. Reload the Task and try again.',
        reread: true,
      };
    case 'DOMAIN_CONFLICT':
      return {
        kind: 'conflict',
        message:
          'This Task’s state does not allow that reminder change, so nothing was saved. Reload the Task to see its current state.',
        reread: false,
      };
    case 'VALIDATION_ERROR':
      return {
        kind: 'validation',
        message:
          'That due date was not accepted, so nothing was saved. Check the date and try again.',
        reread: false,
      };
    case 'NOT_FOUND':
      return {
        kind: 'not_found',
        message: 'This Task could not be found, so nothing was saved.',
        reread: false,
      };
    case 'UNAUTHORIZED':
      return {
        kind: 'unauthorized',
        message: 'Your session expired, so nothing was saved. Sign in again to continue.',
        reread: false,
      };
    default:
      return {
        kind: 'unknown',
        message: 'Rocket could not save that reminder change. Nothing was saved.',
        reread: false,
      };
  }
}
