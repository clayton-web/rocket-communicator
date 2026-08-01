-- A8.4a worker-safety foundation: occurrence claim lifecycle, durable provider acceptance, and the
-- global due-scan index.
--
-- Additive and forward-only. Adds enum values, columns, CHECK constraints, and indexes. Drops
-- nothing, rewrites no row, and backfills nothing beyond column defaults. The A8 migrations this
-- builds on remain unapplied in Production, so this one is equally inert there.
--
-- Enum values are added before any statement that could use them, and nothing in this file
-- references a newly added value. PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a
-- transaction block from version 12 onward provided the new value is not used in the same
-- transaction, which is exactly the shape used here; the local target is PostgreSQL 16.

-- ---------------------------------------------------------------------------
-- Terminal advance dispositions (A8 lifecycle re-audit finding A-A)
-- ---------------------------------------------------------------------------
--
-- The re-audit proved `hasProcessedAdvanceOccurrence` treated any attempt row as processed,
-- including a bare `claimed` lease, and that the schedule column could say `scheduled` while the
-- attempt history said otherwise. The column now carries the terminal outcome, written in the same
-- transaction that terminalizes the occurrence, so the two can no longer disagree.
--
-- Each value is a distinct fact a reader must be able to tell apart. Collapsing them into one
-- `skipped` would recreate the H-2 defect, where history could not answer whether the Owner set a
-- date too late, a Waiting period covered the morning, or the send genuinely failed.
ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'skipped_not_eligible';
ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'failed_permanent';
ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'ambiguous';

-- ---------------------------------------------------------------------------
-- Occurrence claim lifecycle (A8.3a audit F2)
-- ---------------------------------------------------------------------------
--
-- The occurrence row — not the schedule lease — is the duplicate-prevention authority. These
-- columns are what let a worker tell a live claim from an abandoned one, and what let a successor
-- refuse a resurrected predecessor.
ALTER TABLE "reminder_delivery_attempts"
  ADD COLUMN "claim_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "claim_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_call_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "provider_accepted_at" TIMESTAMPTZ(3),
  ADD COLUMN "provider_message_ref" VARCHAR(128);

-- Give the claims that already exist a fencing token before demanding one.
--
-- A8.3b's claim was an indefinite marker with no sequence and no expiry, so every `claimed` row
-- written before this migration would violate `claim_sequence_matches_claim` at the moment it is
-- added — the constraint is checked against existing rows, and the column's default is zero. The
-- backfill writes the sequence such a row would have been granted had it been taken under the new
-- lifecycle: it is the first claim on that occurrence.
--
-- Their `claim_expires_at` deliberately stays NULL. A lease that never expires is not something to
-- invent a deadline for retroactively; a NULL expiry reads as "not a live lease", so the next worker
-- to reach the occurrence reclaims it at sequence 2 and the fence works from there.
UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL;

-- Who holds the claim and when they took it are one fact. A half-written claim that still looked
-- unclaimed is how two workers end up delivering the same occurrence.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_claim_fields_coherent"
  CHECK (("claimed_by" IS NULL) = ("claimed_at" IS NULL));

-- A lease belongs to somebody. An expiry with no owner would be a countdown nobody is running.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_lease_requires_owner"
  CHECK ("claim_expires_at" IS NULL OR "claimed_by" IS NOT NULL);

-- A settled occurrence holds no live lease. `claimed_by` survives terminalization as provenance —
-- which worker recorded this — but the expiry does not, because a completed row advertising a lease
-- that is still ticking is exactly the contradiction the recovery sweep must never see. The sweep
-- filters on `outcome = 'claimed'` as well, so this is the second lock on the same door.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_terminal_holds_no_lease"
  CHECK ("outcome" = 'claimed' OR "claim_expires_at" IS NULL);

-- The fencing token only moves forward. Zero means the row was never claimed — the establishment
-- skip path writes a terminal row without ever taking a lease.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_claim_sequence_non_negative"
  CHECK ("claim_sequence" >= 0);

ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_claim_sequence_matches_claim"
  CHECK ("claimed_by" IS NULL OR "claim_sequence" >= 1);

-- A provider call can only have started under a lease. Without this, an in-flight marker could be
-- set on a row nobody owned, and the ambiguous-recovery rule would fire for an occurrence that had
-- never been attempted.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_provider_start_requires_claim"
  CHECK ("provider_call_started_at" IS NULL OR "claim_sequence" >= 1);

-- Acceptance implies the call was made, and only a success may claim acceptance. A skipped or
-- failed row carrying provider acceptance would misreport a send that did not happen.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_acceptance_implies_started"
  CHECK ("provider_accepted_at" IS NULL OR "provider_call_started_at" IS NOT NULL);

ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_acceptance_only_for_success"
  CHECK ("provider_accepted_at" IS NULL OR "outcome" = 'success');

ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_message_ref_requires_acceptance"
  CHECK ("provider_message_ref" IS NULL OR "provider_accepted_at" IS NOT NULL);

-- The database half of "a lease is not a result" already exists: A8.3a's
-- `reminder_delivery_attempts_completed_at_matches_outcome` proves a `claimed` row has no
-- completion instant and every other outcome has one. Nothing to add here.

-- Expired-claim recovery sweep. Partial: only a `claimed` row can have a lease worth reclaiming,
-- and the index stays small no matter how much terminal history accumulates.
CREATE INDEX "reminder_delivery_attempts_expired_claim_idx"
  ON "reminder_delivery_attempts"("claim_expires_at")
  WHERE "outcome" = 'claimed';

-- ---------------------------------------------------------------------------
-- Schedule: no live lease on a schedule that is not active (F10)
-- ---------------------------------------------------------------------------
--
-- Suspension, stopping, and generation change all clear the lease in application code already. The
-- constraint means a future path that forgets fails loudly instead of leaving a stopped schedule
-- looking claimed, which would make the recovery sweep believe a dead worker still owned it.
ALTER TABLE "task_reminder_schedules"
  ADD CONSTRAINT "task_reminder_schedules_claim_requires_active"
  CHECK ("status" = 'active' OR "claimed_by" IS NULL);

-- ---------------------------------------------------------------------------
-- Global due-scan index (A8.3a audit F11)
-- ---------------------------------------------------------------------------
--
-- The internal worker scan deliberately spans organizations: one Owner organization exists, and a
-- cron job that had to enumerate organizations in application memory would be both slower and a
-- fairness decision made in the wrong place. Every existing schedule index leads with
-- `organization_id`, which cannot serve that scan.
--
-- Partial on `active` because no other status is ever scanned, and ordered to match the scan's own
-- deterministic ordering so the batch bound is a real bound rather than a sort over the table.
CREATE INDEX "task_reminder_schedules_due_scan_idx"
  ON "task_reminder_schedules"("next_overdue_occurrence_at", "id")
  WHERE "status" = 'active';
