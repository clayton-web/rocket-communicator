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
 * Resolve a Task's scope **and hold a row lock on it** for the rest of the transaction
 * (A8.3b audit F2).
 *
 * Every Owner reminder mutation calls this first, so all three of them serialize on the same Task
 * row. The audit demonstrated why on real PostgreSQL: the establishment and generation-change
 * transactions wrote `task_reminder_schedules` before `tasks`, while removal wrote `tasks` before
 * `task_reminder_schedules`, and two concurrent Owner requests deadlocked — PostgreSQL logged
 * `deadlock detected` and the victim surfaced as an unmapped error and a 500.
 *
 * Taking one lock up front fixes the lock order by construction rather than by asking every future
 * transaction to remember the same sequence. It also makes the compare-and-set reads that follow
 * trustworthy: the loser of a race blocks here until the winner commits, then reads the winner's
 * bumped `reminder_version` and fails its own precondition, which is a truthful 412 instead of a
 * deadlock.
 *
 * This is a single-row `FOR UPDATE`, not a table lock, and it is scoped to the Task the caller is
 * already authorized for. `FOR UPDATE` cannot be expressed through the Prisma query API, hence the
 * raw statement; the identifier is bound as a parameter, never interpolated.
 */
export async function lockTaskScopeForReminderMutation(
  db: Client,
  organizationId: string,
  taskId: string,
): Promise<AuthoritativeTaskScope> {
  // Selected by identifier alone, like `requireTaskScope`, so a cross-organization caller is
  // refused explicitly rather than blocked by an empty result it cannot interpret.
  const rows = await db.$queryRaw<Array<{ id: string; organization_id: string }>>`
    SELECT id, organization_id
    FROM tasks
    WHERE id = ${taskId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw notFound(`Task ${taskId} not found.`);
  }
  const row = rows[0];
  if (row.organization_id !== organizationId) {
    throw organizationMismatch('Task organizationId must match the persistence scope.');
  }
  return { taskId: row.id, organizationId: row.organization_id };
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
