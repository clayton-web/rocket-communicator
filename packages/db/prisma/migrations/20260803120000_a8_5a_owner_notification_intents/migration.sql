-- ---------------------------------------------------------------------------
-- A8.5a: Owner Event Notification intent and attempt storage (D133, D135)
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Creates five enum types and two tables. Alters no existing table,
-- drops nothing, rewrites no row, and backfills nothing. The A8 migrations this sits beside remain
-- unapplied in Production, so this one is equally inert there — and `ENABLE_OWNER_EVENT_CAPTURE`
-- keeps the application from touching either table even where it has been applied.
--
-- Every enum type is created before the table that uses it. The local and CI target is PostgreSQL
-- 16; nothing here depends on behaviour newer than that.
--
-- What is deliberately NOT here
--
--   * No foreign key from an intent to its subject. An event is a statement that something happened,
--     and it must stay true and deliverable if the Task, capability, or account it describes is
--     later purged under retention. `subject_kind` / `subject_id` are descriptive.
--   * No destination column. The address is resolved from the connected `CommunicationAccount` at
--     delivery time (D134), so a mailbox disconnected since the event cannot be mailed from a stale
--     copy that outlived the disconnect.
--   * No message content of any kind: no subject, no body, no MIME, no address, no capability token,
--     no excerpt, no provider response payload (D109, D114, D134).
--   * No change to any reminder table. Owner notifications are not a reminder series, and D135
--     declines the reminder policy — no generation, no local-day uniqueness, no ceiling column, no
--     stop reason. Overloading `reminder_delivery_attempts` with a nullable audience discriminator
--     was rejected for exactly the reason those columns would then have to be read as policy.

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

-- The ten canonical event types, closed by D133. The stored values are the ratified dotted names,
-- so the durable data reads as the decision was written rather than as an internal spelling of it.
-- Only `task.completed_by_recipient` has a producer in A8.5a; the rest are created now so A8.5d
-- adds producers rather than enum values, which is also why none of them is used below.
CREATE TYPE "OwnerNotificationEventType" AS ENUM (
  'task.completed_by_recipient',
  'task.clarification_requested',
  'task.returned_to_owner',
  'handoff.delivery_failed',
  'gmail.disconnected',
  'capability.expired',
  'reminder.schedule.stopped.ceiling_reached',
  'reminder.schedule.stopped.permanent_failure',
  'reminder.schedule.stopped.repeated_ambiguous',
  'reminder.no_active_assignment'
);

-- What an intent is about. Descriptive only — see the no-foreign-key note above.
CREATE TYPE "OwnerNotificationSubjectKind" AS ENUM (
  'task',
  'task_capability',
  'task_reminder_schedule',
  'handoff_attempt',
  'communication_account'
);

-- Delivery state (D135). Only `pending` is reachable in A8.5a, which has no worker. The rest of the
-- machine is declared now, with the CHECK constraints that keep it coherent, so A8.5b adds
-- behaviour rather than a second migration — the same choice A8.3a made for the claim-lease columns.
--
-- `ambiguous` is terminal on first occurrence rather than retryable, and that is the deliberate
-- difference from D129: the provider may already have accepted the message, and a duplicate Owner
-- email about an event is a worse untruth than a late one.
CREATE TYPE "OwnerNotificationState" AS ENUM (
  'pending',
  'claimed',
  'sent',
  'failed_retryable',
  'failed_permanent',
  'ambiguous',
  'suppressed',
  'requires_owner_attention'
);

-- Why a notification was terminalized without being delivered. `stale` is D135's 24-hour horizon,
-- which is what stops a backlog flushing when delivery is first enabled; `channel_unavailable` means
-- no connected account satisfied D134, so nothing was attempted. Neither is implemented in A8.5a.
CREATE TYPE "OwnerNotificationSuppressionReason" AS ENUM (
  'stale',
  'channel_unavailable'
);

-- Outcome of one provider attempt. Distinct from the intent state because an attempt can be
-- `in_flight` and can never be `pending` or `suppressed`.
CREATE TYPE "OwnerNotificationAttemptOutcome" AS ENUM (
  'in_flight',
  'sent',
  'failed_retryable',
  'failed_permanent',
  'ambiguous'
);

-- ---------------------------------------------------------------------------
-- owner_notification_intents
-- ---------------------------------------------------------------------------
--
-- One row per notifiable event occurrence, written in the same transaction as the mutation that
-- caused it. That is the whole reason this table exists rather than a query over `audit_events`:
-- `action` there is a free-form string with no enum, the table carries no monotonic ordering column,
-- and several paths write it outside the mutation transaction, so it can record what happened but
-- cannot say what is still owed.
CREATE TABLE "owner_notification_intents" (
  "id"                 VARCHAR(64) NOT NULL,
  "organization_id"    VARCHAR(64) NOT NULL,

  "event_type"         "OwnerNotificationEventType" NOT NULL,
  "subject_kind"       "OwnerNotificationSubjectKind" NOT NULL,
  "subject_id"         VARCHAR(64) NOT NULL,
  "occurrence_key"     VARCHAR(128) NOT NULL,

  "state"              "OwnerNotificationState" NOT NULL DEFAULT 'pending',
  "suppression_reason" "OwnerNotificationSuppressionReason",
  "failure_code"       VARCHAR(64),
  "attempt_count"      INTEGER NOT NULL DEFAULT 0,

  "claimed_by"         VARCHAR(64),
  "claimed_at"         TIMESTAMPTZ(3),
  "claim_expires_at"   TIMESTAMPTZ(3),
  "claim_sequence"     INTEGER NOT NULL DEFAULT 0,

  "occurred_at"        TIMESTAMPTZ(3) NOT NULL,
  "settled_at"         TIMESTAMPTZ(3),

  "actor_kind"         "AuditActorKind" NOT NULL,
  "owner_id"           VARCHAR(64),
  "capability_id"      VARCHAR(64),
  "system_id"          VARCHAR(64),
  "assignment_id"      VARCHAR(64),
  "attribution_label"  VARCHAR(256),

  "audit_event_id"     VARCHAR(64),
  "request_id"         VARCHAR(64),
  "correlation_id"     VARCHAR(64),

  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "owner_notification_intents_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- owner_notification_attempts
-- ---------------------------------------------------------------------------
--
-- Append-only provider history: a retry adds a row rather than rewriting one, so the record can say
-- how many times a provider was contacted and what each contact returned. Nothing writes here in
-- A8.5a.
CREATE TABLE "owner_notification_attempts" (
  "id"                       VARCHAR(64) NOT NULL,
  "organization_id"          VARCHAR(64) NOT NULL,
  "intent_id"                VARCHAR(64) NOT NULL,
  "attempt_number"           INTEGER NOT NULL,

  "outcome"                  "OwnerNotificationAttemptOutcome" NOT NULL,
  "failure_code"             VARCHAR(64),

  "provider_call_started_at" TIMESTAMPTZ(3),
  "provider_accepted_at"     TIMESTAMPTZ(3),
  "provider_message_ref"     VARCHAR(128),

  "created_at"               TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "owner_notification_attempts_pkey" PRIMARY KEY ("id")
);

-- The one foreign key in this migration, and it stays inside the notification subsystem: an attempt
-- without its intent is meaningless. `RESTRICT` rather than `CASCADE` because deleting an intent
-- that a provider was genuinely contacted about would destroy the evidence of that contact.
ALTER TABLE "owner_notification_attempts"
  ADD CONSTRAINT "owner_notification_attempts_intent_id_fkey"
  FOREIGN KEY ("intent_id") REFERENCES "owner_notification_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Deduplication identity (D133)
-- ---------------------------------------------------------------------------
--
-- Identity is server-derived and there is no caller-supplied idempotency key, so a duplicate has to
-- collide on an index it cannot forge — the reasoning D109 applied to reminder occurrences.
--
-- For Task lifecycle events the `occurrence_key` is the post-mutation `Task.version`, which the
-- domain bumps on every transition. A retried mutation therefore cannot produce a second row for
-- the same transition, while a legitimate repeat — a Recipient asking for clarification twice —
-- lands on a different version and is correctly a second row. `reminder.no_active_assignment` uses
-- the schedule generation for the same purpose: D133 limits it to one notification per generation,
-- and this index is what enforces that rather than application care.
CREATE UNIQUE INDEX "owner_notification_intents_identity_key"
  ON "owner_notification_intents"("organization_id", "event_type", "subject_kind", "subject_id", "occurrence_key");

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The claimable-work scan (A8.5b). Partial on `state = 'pending'` so it stays proportional to work
-- outstanding rather than to history: every terminal state leaves the index permanently, and a
-- delivered notification is never revisited. Ordered `(occurred_at, id)` to match the scan's own
-- `ORDER BY`, so a bounded batch is a real bound rather than a sort over the table, and so two
-- concurrent workers see the same candidates in the same order.
--
-- Prisma cannot express a partial index, so this one exists only here; the schema declares the
-- non-partial `owner_notification_intents_occurred_at_idx` beside it, which is the same split the
-- reminder due-scan indexes use.
CREATE INDEX "owner_notification_intents_pending_idx"
  ON "owner_notification_intents"("occurred_at", "id")
  WHERE "state" = 'pending';

CREATE INDEX "owner_notification_intents_occurred_at_idx"
  ON "owner_notification_intents"("occurred_at", "id");

-- "What has this subject produced" for the A8.6 Owner surface.
CREATE INDEX "owner_notification_intents_subject_idx"
  ON "owner_notification_intents"("organization_id", "subject_kind", "subject_id");

-- A duplicate attempt collides rather than double-counting the provider contacts.
CREATE UNIQUE INDEX "owner_notification_attempts_intent_attempt_key"
  ON "owner_notification_attempts"("intent_id", "attempt_number");

CREATE INDEX "owner_notification_attempts_org_intent_idx"
  ON "owner_notification_attempts"("organization_id", "intent_id");

-- ---------------------------------------------------------------------------
-- State coherence
-- ---------------------------------------------------------------------------
--
-- These are the invariants the database can hold on its own, so a worker bug in A8.5b produces a
-- failed write rather than a row that quietly lies about what happened.

-- A terminal state has a settlement instant and a non-terminal one does not. Without this a
-- notification could read `sent` with no record of when, or sit `pending` with a settlement time
-- already written — and the A8.6 surface would have no way to tell which field to believe.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_settled_at_matches_state"
  CHECK (
    ("state" IN ('sent', 'failed_permanent', 'ambiguous', 'suppressed', 'requires_owner_attention')
      AND "settled_at" IS NOT NULL)
    OR
    ("state" IN ('pending', 'claimed', 'failed_retryable') AND "settled_at" IS NULL)
  );

-- A suppression reason is exactly the set of cases where nothing was sent on purpose. Allowing a
-- reason on a delivered notification, or a suppression with no reason, would leave "why did the
-- Owner never hear about this" unanswerable — which is the question the A8.6 surface exists to
-- answer.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_suppression_reason_matches_state"
  CHECK (("state" = 'suppressed') = ("suppression_reason" IS NOT NULL));

-- A failure code belongs only to a state that failed. A `sent` row carrying one would be a
-- contradiction, and a `pending` row carrying one would be a leftover from a previous attempt.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_failure_code_matches_state"
  CHECK (
    "failure_code" IS NULL
    OR "state" IN ('failed_retryable', 'failed_permanent', 'ambiguous', 'requires_owner_attention')
  );

-- Who holds the claim, when they took it, and when it lapses are one fact. A half-written claim that
-- still looked unclaimed is how two workers end up delivering the same notification — the same
-- reasoning as `reminder_delivery_attempts_claim_fields_coherent`.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_claim_fields_coherent"
  CHECK (
    ("claimed_by" IS NULL AND "claimed_at" IS NULL AND "claim_expires_at" IS NULL)
    OR
    ("claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  );

-- A lease exists only while the row is claimed. A released or terminalized notification still
-- carrying a live lease would be reclaimed by nobody and delivered by nobody.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_claim_only_when_claimed"
  CHECK (("state" = 'claimed') = ("claimed_by" IS NOT NULL));

-- A claimed row has been claimed at least once. The fence starts at zero and every claim increments
-- it, so a zero sequence on a claimed row means the increment was skipped and a resurrected
-- predecessor could still pass a fence check.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_claim_sequence_valid"
  CHECK ("claim_sequence" >= 0 AND ("state" <> 'claimed' OR "claim_sequence" >= 1));

-- Counters count. Negative is not a state the delivery policy can reach, so it is a bug.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_attempt_count_valid"
  CHECK ("attempt_count" >= 0);

-- Identity components must actually identify something. An empty subject or occurrence key would
-- make the unique index admit rows that collide with nothing and deduplicate nothing.
ALTER TABLE "owner_notification_intents"
  ADD CONSTRAINT "owner_notification_intents_identity_present"
  CHECK (LENGTH("subject_id") > 0 AND LENGTH("occurrence_key") > 0);

-- Attempts are 1-based, matching `attempt_number` against a human-readable count of provider calls.
ALTER TABLE "owner_notification_attempts"
  ADD CONSTRAINT "owner_notification_attempts_attempt_number_valid"
  CHECK ("attempt_number" >= 1);

-- Durable proof of acceptance belongs to `sent` and to nothing else. This is the reminder F1
-- invariant restated: an outcome that claims the provider accepted must carry when and what, and an
-- outcome that does not claim it must carry neither.
ALTER TABLE "owner_notification_attempts"
  ADD CONSTRAINT "owner_notification_attempts_acceptance_matches_outcome"
  CHECK (
    ("outcome" = 'sent' AND "provider_accepted_at" IS NOT NULL AND "provider_message_ref" IS NOT NULL)
    OR
    ("outcome" <> 'sent' AND "provider_accepted_at" IS NULL)
  );

-- An outcome that reports what the provider did requires evidence the provider was called. An
-- `ambiguous` attempt is precisely one where the call started and the answer never arrived, so it
-- needs the marker most of all.
ALTER TABLE "owner_notification_attempts"
  ADD CONSTRAINT "owner_notification_attempts_provider_call_recorded"
  CHECK (
    "outcome" NOT IN ('sent', 'ambiguous')
    OR "provider_call_started_at" IS NOT NULL
  );

-- A failure code belongs only to a failed attempt.
ALTER TABLE "owner_notification_attempts"
  ADD CONSTRAINT "owner_notification_attempts_failure_code_matches_outcome"
  CHECK (
    "failure_code" IS NULL
    OR "outcome" IN ('failed_retryable', 'failed_permanent', 'ambiguous')
  );

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Deny-by-default with no policies, matching every other domain table (D032 as defence in depth).
-- Authorization is enforced in the application; RLS is what makes a direct connection that bypasses
-- it return nothing rather than everything.
ALTER TABLE "owner_notification_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "owner_notification_attempts" ENABLE ROW LEVEL SECURITY;
