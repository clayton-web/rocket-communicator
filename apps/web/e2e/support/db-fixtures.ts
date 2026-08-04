import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DATABASE_URL, E2E_ORGANIZATION_ID, assertLocalDatabaseUrl } from '../config/e2e-env';

/**
 * Fixture access to the disposable LOCAL database.
 *
 * Used only where no Owner HTTP surface exists for the fixture: attaching an active
 * assignment (the create-with-assignment service path was removed in A7.6/D091, and the
 * handoff path requires Gmail, which P1.2 excludes) and ageing a capability so the real
 * expiry branch is exercised. Also used for server-side assertions after Recipient actions.
 *
 * Delegates to an ESM child process because the workspace packages are ESM-only.
 */

const FIXTURE_SCRIPT = path.resolve(__dirname, '../scripts/db-fixture.mjs');

function runFixture<T>(command: Record<string, unknown>): T {
  assertLocalDatabaseUrl(E2E_DATABASE_URL);

  const stdout = execFileSync('node', [FIXTURE_SCRIPT, JSON.stringify(command)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_DATABASE_URL,
      E2E_ORGANIZATION_ID,
    },
  });

  const parsed = JSON.parse(stdout) as { ok: boolean; result?: T; error?: string };
  if (!parsed.ok) {
    throw new Error(`Database fixture failed: ${parsed.error}`);
  }
  return parsed.result as T;
}

/** Attach an active assignment so a Recipient capability can be issued for the Task. */
export function attachActiveAssignment(input: {
  taskId: string;
  recipientId: string;
  recipientEmail: string;
  ownerId: string;
}): { assignmentId: string } {
  return runFixture({ action: 'attach-assignment', ...input });
}

/**
 * Stop a Task's Reminder Schedule and flag it for Owner attention, for the `/attention` page.
 *
 * There is no Owner HTTP surface for this and no permitted way to reach it through the product:
 * the flag is raised only by the A8.4b reminder worker settling a real delivery, which requires
 * `ENABLE_REMINDER_DELIVERY`. Seeding it is what makes the populated page — and its accessibility
 * scan — testable in the browser with every flag still unset.
 */
export function stopReminderScheduleForAttention(input: {
  taskId: string;
  dueLocalDate: string;
  stopReason:
    'overdue_ceiling_reached' | 'permanent_delivery_failure' | 'repeated_ambiguous_outcomes';
}): void {
  runFixture({ action: 'stop-reminder-schedule', ...input });
}

/**
 * Remove every Reminder Schedule in the organization, so a whole-list assertion is provable.
 *
 * The harness migrates the local database but never truncates it. Other specs absorb the leftover
 * rows by filtering on a unique label; `/attention` cannot, because "nothing needs your attention"
 * and "exactly one item needs attention" are claims about the entire list. A single row seeded by
 * an earlier run would falsify both permanently. Tests that assert on the whole list call this
 * first rather than depending on the order they happen to run in.
 */
export function clearReminderSchedules(): void {
  runFixture({ action: 'clear-reminder-schedules' });
}

/**
 * A reminder-stop event type, named here rather than in a spec.
 *
 * Two members of the A8.5 event enum are longer than forty characters, which is exactly the shape
 * the P1.2 capability-secret sweep looks for in a spec file. Keeping the literal in the fixture
 * module lets that guard stay strict rather than learning an exception for a vocabulary that has
 * nothing to do with secrets.
 */
export const REMINDER_STOP_EVENT_TYPE = 'reminder_schedule_stopped_ceiling_reached';

/**
 * Seed an Owner notification that was never delivered, for `/attention` section two (A8.6c).
 *
 * There is no product path to this state and there is not meant to be one. Capture is behind
 * `ENABLE_OWNER_EVENT_CAPTURE`, and the terminal states this section shows are written only by the
 * A8.5b delivery worker, which additionally needs `ENABLE_OWNER_EVENT_DELIVERY` and a real Gmail
 * send. Seeding is what makes the populated section — and its accessibility scan — testable in the
 * browser with every flag still unset.
 */
export function seedUndeliveredNotification(input: {
  taskId: string;
  eventType?:
    | 'task_completed_by_recipient'
    | 'task_clarification_requested'
    | 'task_returned_to_owner'
    | 'handoff_delivery_failed'
    | 'gmail_disconnected'
    | 'capability_expired'
    | typeof REMINDER_STOP_EVENT_TYPE
    | 'reminder_no_active_assignment';
  state?: 'suppressed' | 'failed_permanent' | 'ambiguous' | 'requires_owner_attention' | 'sent';
  suppressionReason?: 'stale' | 'channel_unavailable';
  actorKind?: 'owner' | 'capability' | 'system';
  occurredAt?: string;
}): { intentId: string } {
  return runFixture({ action: 'seed-undelivered-notification', ...input });
}

/**
 * Remove every Owner notification intent in the organization, so a whole-list assertion holds.
 *
 * Section two's empty state is a claim about the entire list, and the harness never truncates the
 * local database, so a row seeded by an earlier run would falsify it permanently.
 */
export function clearOwnerNotifications(): void {
  runFixture({ action: 'clear-owner-notifications' });
}

/** Age a capability so the application's real expiry rejection can be exercised. */
export function expireCapability(capabilityId: string): void {
  runFixture({ action: 'expire-capability', capabilityId });
}

/** Server-side assertion: current persisted Task status, version, and completion outcome. */
export function readTaskState(
  taskId: string,
): { status: string; version: number; outcome: unknown } | null {
  return runFixture({ action: 'read-task', taskId });
}

export interface CapabilityState {
  status: string;
  revokedAt: string | null;
  revocationReason: string | null;
  actionableAt: string | null;
  expiresAt: string;
  assignmentCapabilityStatus: string | null;
  assignmentDeliveryStatus: string | null;
}

/**
 * Server-side assertion: business-meaningful capability and assignment state.
 * Excludes `lastUsedAt`, which the schema defines as an access stamp rather than consumption.
 */
export function readCapabilityState(capabilityId: string): CapabilityState | null {
  return runFixture({ action: 'read-capability-state', capabilityId });
}

/** Server-side assertion: persisted notes for a Task. */
export function readTaskNotes(taskId: string): { body: string; attribution: unknown }[] {
  return runFixture({ action: 'read-notes', taskId });
}
