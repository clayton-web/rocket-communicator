import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { notFound, organizationMismatch } from '../errors/persistence-errors.js';

/**
 * Authoritative organization scoping for reminder writes (A8.3a audit F3).
 *
 * The A8.3a audit proved that `organization_id` and `task_id` are independent columns with
 * independent foreign keys, so the database will accept a Reminder Schedule declaring one
 * organization while pointing at a Task owned by another. Nothing downstream re-checks it, and the
 * consequence of getting it wrong is a reminder email about one organization's Task sent under
 * another organization's scope.
 *
 * Every reminder write therefore resolves its organization from the referenced row rather than
 * trusting the caller's word for it. The caller's value is still required — it is how a caller
 * asserts the scope it believes it is operating in — but it is treated as a claim to verify, never
 * as the value to store.
 *
 * A composite foreign key to `tasks(id, organization_id)` would enforce this in the database and
 * remains the stronger fix; it needs a unique constraint on `tasks(id, organization_id)` and a
 * migration, which this remediation is not authorized to add.
 */

type Client = DbClient | DbTransaction;

/** A Task's real owning organization, resolved from the Task row itself. */
export interface AuthoritativeTaskScope {
  readonly taskId: string;
  readonly organizationId: string;
}

/** A Reminder Schedule's real owning organization and Task, resolved from the schedule row. */
export interface AuthoritativeScheduleScope {
  readonly scheduleId: string;
  readonly organizationId: string;
  readonly taskId: string;
}

/**
 * Resolve the organization that owns `taskId`, refusing a caller that claims a different one.
 *
 * The lookup is deliberately by identifier **alone**. Reading with `{ id, organizationId }` — the
 * pattern used for ordinary scoped reads — cannot distinguish "no such Task" from "a Task you may
 * not touch", so a cross-organization write would surface as a silent no-op or a confusing
 * not-found rather than a refusal. Reading first and comparing afterwards makes the disagreement
 * explicit and refusable.
 */
export async function requireTaskScope(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<AuthoritativeTaskScope> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, organizationId: true },
  });
  if (!task) {
    throw notFound(`Task ${taskId} not found.`);
  }
  if (task.organizationId !== organizationId) {
    throw organizationMismatch('Task organizationId must match the persistence scope.');
  }
  return { taskId: task.id, organizationId: task.organizationId };
}

/**
 * Resolve the organization and Task that own `scheduleId`, refusing a mismatched caller.
 *
 * Returning the schedule's `taskId` is what lets delivery-attempt writes stop accepting a Task
 * identifier from the caller: an attempt belongs to whichever Task its schedule belongs to, so the
 * caller has nothing to supply and therefore nothing to get wrong.
 */
export async function requireScheduleScope(
  db: Client,
  organizationId: string,
  scheduleId: string,
): Promise<AuthoritativeScheduleScope> {
  const schedule = await db.taskReminderSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, organizationId: true, taskId: true },
  });
  if (!schedule) {
    throw notFound(`Reminder schedule ${scheduleId} not found.`);
  }
  if (schedule.organizationId !== organizationId) {
    throw organizationMismatch(
      'Reminder schedule organizationId must match the persistence scope.',
    );
  }
  return {
    scheduleId: schedule.id,
    organizationId: schedule.organizationId,
    taskId: schedule.taskId,
  };
}
