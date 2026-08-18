import 'server-only';
import { findExactGmailMessageId, type Task } from '@aicaa/domain';
import type { GmailForwardSource } from '@/lib/gmail/outbound/gmail-forward';

/**
 * Trusted forward-source resolver (A7.7).
 *
 * Derives the Gmail provider message id to forward ONLY from the trusted, persisted Task source
 * reference — never from the request body, a caller-supplied message/thread/account id, or a
 * delivery-mode hint. Requirements (D090, D094):
 *
 *  - `task.sourceReference.sourceType === 'gmail'`;
 *  - an `externalIds` entry with `provider === 'gmail'` and a non-empty exact-message id.
 *
 * Canonical `idType` is `message_id` (A5/A7). Review-era persisted Tasks may still carry
 * `idType === 'message'`; both store Gmail's `users.messages.get` id. A `thread` id is never
 * treated as an exact message. This helper uses the same exact-id rule as
 * `hasUsableGmailSourceIdentifiers`, so preflight and resolution cannot disagree.
 *
 * The authenticated organization's resolved Gmail `accountId` (from the access resolver) is supplied
 * by the preparer and used as the ownership guard. When the trusted reference is incomplete this
 * returns `undefined`, which the preparer surfaces as GMAIL_SOURCE_MESSAGE_UNAVAILABLE — there is no
 * silent downgrade to assignment_email for a Gmail-origin Task.
 */
export function resolveTaskGmailForwardSource(input: {
  organizationId: string;
  accountId: string;
  attemptId: string;
  task: Task;
}): GmailForwardSource | undefined {
  const providerMessageId = findExactGmailMessageId(input.task.sourceReference);
  if (!providerMessageId) {
    return undefined;
  }
  return {
    providerMessageId,
    organizationId: input.organizationId,
    accountId: input.accountId,
  };
}

/** Async adapter matching the orchestrator/preparer forward-source port. */
export function createTaskGmailForwardSource(): (input: {
  organizationId: string;
  accountId: string;
  attemptId: string;
  task: Task;
}) => Promise<GmailForwardSource | undefined> {
  return async (input) => resolveTaskGmailForwardSource(input);
}
