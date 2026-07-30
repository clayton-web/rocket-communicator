import type { APIRequestContext } from '@playwright/test';
import { E2E_OWNER_ID, E2E_WORKSPACE_DOMAIN } from '../config/e2e-env';
import { attachActiveAssignment } from './db-fixtures';
import {
  createRecipient,
  createTask,
  getTask,
  issueCapability,
  type IssuedCapability,
  type SeededTask,
} from './owner-api';
import { uniqueLabel } from './fixtures';
import { recordCapabilityTokenFingerprint } from './artifact-safety';

/**
 * Build a complete Recipient capability fixture: Task, active assignment, and a freshly
 * issued capability link.
 *
 * The assignment is attached through the database fixture because the only application path
 * that creates one is Gmail handoff (A7), which P1.2 excludes. Capability issuance itself
 * goes through the real Owner route so the token is minted by production issuance code.
 *
 * The returned raw token must never be logged, titled, or written to an artifact.
 */
export async function seedCapabilityFixture(
  request: APIRequestContext,
  kind: string,
): Promise<{
  task: SeededTask;
  capability: IssuedCapability;
  recipientEmail: string;
  taskTitle: string;
}> {
  const taskTitle = uniqueLabel(`task-${kind}`);
  // Deliberately not derived from the Task title so assertions cannot match both strings.
  const recipientEmail = `${uniqueLabel(`rcpt-${kind}`)}@${E2E_WORKSPACE_DOMAIN}`;

  const task = await createTask(request, 'Fixture point', taskTitle);
  const recipient = await createRecipient(request, `Recipient ${kind}`, recipientEmail);

  attachActiveAssignment({
    taskId: task.id,
    recipientId: recipient.id,
    recipientEmail,
    ownerId: E2E_OWNER_ID,
  });

  // Assignment attachment changes the Task version; re-read before the If-Match issuance call.
  const current = await getTask(request, task.id);
  const capability = await issueCapability(request, current);

  // Register a one-way fingerprint so the post-run sweep can detect this exact token even if
  // it reaches an artifact bare, without a `/c/` prefix. The raw token itself is not written.
  recordCapabilityTokenFingerprint(capability.token);

  return { task: await getTask(request, task.id), capability, recipientEmail, taskTitle };
}
