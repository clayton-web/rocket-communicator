-- A8.3b audit remediation: reminder concurrency token and the Waiting-suspension invariant.
--
-- Additive and forward-only. Adds one column and one CHECK constraint to
-- `task_reminder_schedules`; creates no table, drops nothing, rewrites nothing, and performs no
-- backfill beyond the column default. The A8.3a migration this builds on is still unapplied in
-- Production, so this migration is equally inert there: it changes what a reminder write must
-- prove, not whether anything sends.
--
-- Why a column rather than a derived token. The audit (F5) showed the reminder resource had no
-- concurrency token of its own: mutations required a Task `If-Match`, but reminder writes
-- deliberately do not bump `tasks.version`, so two Owners could each believe their due-date change
-- was current. A token computed from the visible state alone cannot express "this row was stopped
-- and reactivated back to the same generation", so the version is persisted.

-- ---------------------------------------------------------------------------
-- reminder_version: optimistic-concurrency version for the reminder resource
-- ---------------------------------------------------------------------------
--
-- Existing rows (none in Production; development and test rows only) adopt version 1, which is
-- also the value a newly established schedule starts at. A caller observing a schedule for the
-- first time therefore sees v1 whether the row predates this migration or not.
--
-- Incremented by: opening a generation, reactivating a stopped schedule, suspending for Waiting,
-- resuming from Waiting, stopping. Not incremented by: recording a delivery, raising the
-- Owner-attention flag, acquiring or releasing a claim lease. That split is deliberate — the token
-- exists to stop Owners overwriting each other, and a worker must not be able to invalidate an
-- Owner's in-flight edit by doing its own job.
ALTER TABLE "task_reminder_schedules"
  ADD COLUMN "reminder_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "task_reminder_schedules"
  ADD CONSTRAINT "task_reminder_schedules_reminder_version_positive"
  CHECK ("reminder_version" >= 1);

-- ---------------------------------------------------------------------------
-- A suspended schedule owes no claimable occurrence (D107)
-- ---------------------------------------------------------------------------
--
-- The sibling constraint `task_reminder_schedules_stopped_has_no_next_occurrence` already proves
-- this for `stopped`. A8.3b can now create a schedule that is born `suspended_waiting` — an Owner
-- setting a due date on a Waiting Task — so the same guarantee is needed for suspension, and for
-- the same reason: `task_reminder_schedules_org_status_next_overdue_idx` is the future worker's
-- due-scan, and a suspended row carrying a next occurrence would sit in it waiting to be claimed.
--
-- D107 also requires resume to select the next *future* occurrence with no backlog, which is only
-- expressible if suspension discards the occurrence it was holding rather than preserving a date
-- that will be in the past by the time the Task leaves Waiting.
ALTER TABLE "task_reminder_schedules"
  ADD CONSTRAINT "task_reminder_schedules_suspended_has_no_next_occurrence"
  CHECK ("status" <> 'suspended_waiting' OR "next_overdue_occurrence_at" IS NULL);
