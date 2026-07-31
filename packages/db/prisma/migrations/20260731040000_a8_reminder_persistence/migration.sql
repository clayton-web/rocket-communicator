-- A8.3a reminder persistence foundation (D102–D110, D127)
--
-- Adds the two durable concepts D109 requires: a Task Reminder Schedule and reminder delivery
-- attempts whose idempotency is enforced by a database constraint rather than application code.
--
-- Scheduling is NOT implemented here. No trigger, default, or generated column derives an
-- occurrence: every occurrence value is supplied by the A8.2 domain (D103). This migration adds
-- storage and integrity only — no worker, scheduler, cron, endpoint, flag, email path, or UI.
--
-- Additive and forward-only. Existing rows are untouched: `tasks.due_local_date` is added NULL and
-- deliberately NOT backfilled from `due_at`, because D109 forbids historical due-date data from
-- activating reminders. Reminders begin only when an Owner explicitly saves a due date and a
-- schedule row is created. Deny-by-default RLS on both new tables.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Waiting is the only suspension mechanism (D097, D107): there is deliberately no 'paused' or
-- 'snoozed' value, so a second pause control cannot be introduced by data alone.
CREATE TYPE "ReminderScheduleStatus" AS ENUM ('active', 'suspended_waiting', 'stopped');

CREATE TYPE "ReminderScheduleStopReason" AS ENUM (
  'task_completed',
  'task_dismissed',
  'due_date_removed',
  'overdue_ceiling_reached',
  'permanent_delivery_failure'
);

-- Decided once at establishment and never reclassified (D105).
CREATE TYPE "ReminderAdvanceDisposition" AS ENUM ('scheduled', 'skipped_window_elapsed');

-- Mirrors the A8.2 domain ReminderOccurrenceOutcome['occurrence'] union exactly.
CREATE TYPE "ReminderOccurrenceKind" AS ENUM ('advance', 'overdue');

-- Mirrors the A8.2 domain ReminderOccurrenceOutcome['outcome'] union exactly. 'claimed' is a lease,
-- not a delivery: D106 requires claims, failures, ambiguity, and skips to be excluded from the
-- overdue ceiling, which is only possible if they are representable and distinguishable.
CREATE TYPE "ReminderDeliveryOutcome" AS ENUM (
  'claimed',
  'success',
  'retryable_failure',
  'permanent_failure',
  'ambiguous',
  'skipped'
);

CREATE TYPE "ReminderSkipReason" AS ENUM (
  'advance_window_elapsed',
  'no_active_assignment',
  'task_not_eligible',
  'schedule_superseded'
);

-- ---------------------------------------------------------------------------
-- Task: authoritative organization-local due calendar date (D103, D109)
-- ---------------------------------------------------------------------------

-- Text, not DATE. Prisma surfaces a DATE column as a DateTime, which would reintroduce exactly the
-- instant-vs-calendar-date confusion D103 exists to remove.
ALTER TABLE "tasks" ADD COLUMN "due_local_date" VARCHAR(10);

-- Shape and range only. Postgres CHECK expressions must be IMMUTABLE, and the text->date cast is
-- not, so real Gregorian validity (2026-02-30, leap years) is enforced one layer up by the domain
-- `parseLocalDate` at the persistence boundary. The database guarantees canonical form; the domain
-- guarantees the date exists.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_due_local_date_canonical"
  CHECK (
    "due_local_date" IS NULL
    OR "due_local_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  );

-- ---------------------------------------------------------------------------
-- TaskReminderSchedule (durable scheduling state; at most one per Task)
-- ---------------------------------------------------------------------------

CREATE TABLE "task_reminder_schedules" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "due_local_date" VARCHAR(10) NOT NULL,
    "scheduling_time_zone" VARCHAR(64) NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "ReminderScheduleStatus" NOT NULL DEFAULT 'active',
    "stop_reason" "ReminderScheduleStopReason",
    "stopped_at" TIMESTAMPTZ(3),
    "suspended_at" TIMESTAMPTZ(3),
    "requires_owner_attention" BOOLEAN NOT NULL DEFAULT false,
    "advance_disposition" "ReminderAdvanceDisposition" NOT NULL,
    -- Always present: the advance occurrence is the day before the due date, so it exists even when
    -- its window had already elapsed and the disposition is 'skipped_window_elapsed' (D105). Storing
    -- it unconditionally is what lets the Owner surface say *which* morning was missed.
    "advance_occurrence_local_date" VARCHAR(10) NOT NULL,
    "advance_occurrence_at" TIMESTAMPTZ(3) NOT NULL,
    "next_overdue_occurrence_local_date" VARCHAR(10),
    "next_overdue_occurrence_at" TIMESTAMPTZ(3),
    "overdue_delivered_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_by" VARCHAR(64),
    "claimed_at" TIMESTAMPTZ(3),
    "claim_expires_at" TIMESTAMPTZ(3),
    "established_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_reminder_schedules_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "task_reminder_schedules_due_local_date_canonical"
      CHECK ("due_local_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),

    CONSTRAINT "task_reminder_schedules_advance_local_date_canonical"
      CHECK ("advance_occurrence_local_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),

    CONSTRAINT "task_reminder_schedules_next_overdue_local_date_canonical"
      CHECK (
        "next_overdue_occurrence_local_date" IS NULL
        OR "next_overdue_occurrence_local_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      ),

    -- Generations are monotonic and 1-based (D104).
    CONSTRAINT "task_reminder_schedules_generation_positive"
      CHECK ("generation" >= 1),

    -- D106: the ceiling is 14 successful overdue deliveries per generation. Mirrors the A8.2 domain
    -- constant OVERDUE_SUCCESSFUL_DELIVERY_CEILING; a test asserts the two cannot drift apart. This
    -- is a backstop, not the policy: application flow stops at the ceiling before reaching it.
    CONSTRAINT "task_reminder_schedules_overdue_delivered_count_bounded"
      CHECK ("overdue_delivered_count" BETWEEN 0 AND 14),

    -- A stop reason is recorded exactly when the schedule is stopped, so a stopped schedule can
    -- never be silent about why it stopped, and a live schedule can never carry a stale reason.
    CONSTRAINT "task_reminder_schedules_stop_reason_matches_status"
      CHECK (
        ("status" = 'stopped' AND "stop_reason" IS NOT NULL AND "stopped_at" IS NOT NULL)
        OR ("status" <> 'stopped' AND "stop_reason" IS NULL AND "stopped_at" IS NULL)
      ),

    -- Waiting suspension is timestamped (D107); a non-suspended schedule carries no suspension time.
    CONSTRAINT "task_reminder_schedules_suspended_at_matches_status"
      CHECK (
        ("status" = 'suspended_waiting' AND "suspended_at" IS NOT NULL)
        OR ("status" <> 'suspended_waiting' AND "suspended_at" IS NULL)
      ),

    -- The next overdue occurrence is a local date and an instant together, or neither.
    CONSTRAINT "task_reminder_schedules_next_overdue_pair_coherent"
      CHECK (
        ("next_overdue_occurrence_local_date" IS NULL AND "next_overdue_occurrence_at" IS NULL)
        OR ("next_overdue_occurrence_local_date" IS NOT NULL AND "next_overdue_occurrence_at" IS NOT NULL)
      ),

    -- A stopped schedule has no future occurrence. Without this, a stopped schedule could still be
    -- returned by the future worker's due-scan index and deliver after it was told to stop.
    CONSTRAINT "task_reminder_schedules_stopped_has_no_next_occurrence"
      CHECK ("status" <> 'stopped' OR "next_overdue_occurrence_at" IS NULL),

    -- Claim lease columns move together, so a half-written lease cannot look like a free schedule.
    CONSTRAINT "task_reminder_schedules_claim_fields_coherent"
      CHECK (
        ("claimed_by" IS NULL AND "claimed_at" IS NULL AND "claim_expires_at" IS NULL)
        OR ("claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
      )
);

-- D104: at most one Reminder Schedule per Task. Unique, not merely indexed — the schedule is
-- Task-scoped and survives reassignment, so a second row would silently double every reminder.
CREATE UNIQUE INDEX "task_reminder_schedules_task_id_key"
  ON "task_reminder_schedules"("task_id");

-- Due-scan for the future A8.4 worker: eligible schedules whose next occurrence has arrived.
CREATE INDEX "task_reminder_schedules_org_status_next_overdue_idx"
  ON "task_reminder_schedules"("organization_id", "status", "next_overdue_occurrence_at");

CREATE INDEX "task_reminder_schedules_org_status_advance_idx"
  ON "task_reminder_schedules"("organization_id", "status", "advance_occurrence_at");

-- Owner attention surface (D108).
CREATE INDEX "task_reminder_schedules_org_requires_owner_attention_idx"
  ON "task_reminder_schedules"("organization_id", "requires_owner_attention");

-- Reclaiming expired leases without scanning the table.
CREATE INDEX "task_reminder_schedules_claim_expires_at_idx"
  ON "task_reminder_schedules"("claim_expires_at");

ALTER TABLE "task_reminder_schedules"
  ADD CONSTRAINT "task_reminder_schedules_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_reminder_schedules" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- ReminderDeliveryAttempt (append-only processed-occurrence history)
-- ---------------------------------------------------------------------------

CREATE TABLE "reminder_delivery_attempts" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "schedule_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "generation" INTEGER NOT NULL,
    "occurrence_kind" "ReminderOccurrenceKind" NOT NULL,
    "occurrence_local_date" VARCHAR(10) NOT NULL,
    "occurrence_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" "ReminderDeliveryOutcome" NOT NULL,
    "skip_reason" "ReminderSkipReason",
    "failure_code" VARCHAR(64),
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "claimed_at" TIMESTAMPTZ(3),
    "claimed_by" VARCHAR(64),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminder_delivery_attempts_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "reminder_delivery_attempts_occurrence_local_date_canonical"
      CHECK ("occurrence_local_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),

    CONSTRAINT "reminder_delivery_attempts_generation_positive"
      CHECK ("generation" >= 1),

    CONSTRAINT "reminder_delivery_attempts_attempt_count_positive"
      CHECK ("attempt_count" >= 1),

    -- D105/D107 require a *truthful* skip reason. A skip with no reason would be an unexplained
    -- non-delivery in the Owner's history, and a reason on a non-skip would misdescribe a send.
    CONSTRAINT "reminder_delivery_attempts_skip_reason_matches_outcome"
      CHECK (
        ("outcome" = 'skipped' AND "skip_reason" IS NOT NULL)
        OR ("outcome" <> 'skipped' AND "skip_reason" IS NULL)
      ),

    -- A failure code belongs only to a failure. Notably it may never accompany 'success', which is
    -- what keeps the ceiling-counting rule (D106) reading unambiguous rows.
    CONSTRAINT "reminder_delivery_attempts_failure_code_only_on_failure"
      CHECK (
        "failure_code" IS NULL
        OR "outcome" IN ('retryable_failure', 'permanent_failure', 'ambiguous')
      ),

    -- 'claimed' is the only non-terminal outcome; everything else is a completed occurrence.
    CONSTRAINT "reminder_delivery_attempts_completed_at_matches_outcome"
      CHECK (
        ("outcome" = 'claimed' AND "completed_at" IS NULL)
        OR ("outcome" <> 'claimed' AND "completed_at" IS NOT NULL)
      )
);

-- D109: server-derived idempotency enforced by a database constraint, not application code.
-- There is no caller-supplied key: identity *is* the occurrence, and it encodes the local calendar
-- day. Duplicate or overlapping scheduler invocations collide here rather than double-sending.
CREATE UNIQUE INDEX "reminder_delivery_attempts_occurrence_identity_key"
  ON "reminder_delivery_attempts"("schedule_id", "generation", "occurrence_kind", "occurrence_local_date");

-- D106: "at most one delivery per local calendar day". Deliberately scoped to the schedule and the
-- local day, and NOT to the generation: a material due-date change must not license a second
-- successful delivery on a day the Recipient already heard from us.
CREATE UNIQUE INDEX "reminder_delivery_attempts_one_success_per_local_day_idx"
  ON "reminder_delivery_attempts"("schedule_id", "occurrence_local_date")
  WHERE "outcome" = 'success';

CREATE INDEX "reminder_delivery_attempts_org_task_occurrence_idx"
  ON "reminder_delivery_attempts"("organization_id", "task_id", "occurrence_at");

-- Ceiling accounting: successful overdue rows within one generation (D106).
CREATE INDEX "reminder_delivery_attempts_schedule_generation_outcome_idx"
  ON "reminder_delivery_attempts"("schedule_id", "generation", "outcome");

CREATE INDEX "reminder_delivery_attempts_org_outcome_occurrence_idx"
  ON "reminder_delivery_attempts"("organization_id", "outcome", "occurrence_at");

ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "task_reminder_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reminder_delivery_attempts" ENABLE ROW LEVEL SECURITY;
