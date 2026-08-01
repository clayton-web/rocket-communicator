-- A8.4a audit remediation: the durable seam between terminalizing an occurrence and settling its
-- schedule, plus the two recovery indexes the sweeps that discharge that debt need.
--
-- Additive and forward-only. Adds one nullable column, one backfill, one CHECK, and two partial
-- indexes. Drops nothing and rewrites no column that anything already reads. The A8 migrations this
-- builds on remain unapplied in Production, so this one is equally inert there.
--
-- ## Why the column exists (audit finding H1)
--
-- `finalizeReminderOccurrence` recorded the terminal outcome and settled the schedule in one
-- transaction, on the stated grounds that "phase two cannot abort phase one" because every
-- phase-two write was a conditional update whose zero-row result is a no-op. Fault injection
-- disproved it: a CHECK violation, a unique collision, or any unexpected error raised anywhere in
-- phase two aborts the whole transaction, and the row saying a Recipient was emailed disappears
-- with it. That is the original F1 defect, narrowed rather than closed.
--
-- The two phases are now two transactions, which raises the opposite question the single
-- transaction was chosen to avoid: a crash between them leaves the occurrence terminal and the
-- schedule un-advanced. That state is now *representable and queryable* rather than invisible —
-- which is the whole difference. A terminal row with a null `schedule_settled_at` is settlement
-- debt, the worker discharges it before doing new work, and settlement is idempotent so
-- discharging it twice counts once.
--
-- ## A correction to the previous migration's header
--
-- `20260801120000_a8_4a_worker_safety` states it "backfills nothing beyond column defaults". That
-- is wrong: it runs `UPDATE ... SET claim_sequence = 1 WHERE claimed_by IS NOT NULL`, which the
-- body of that same file goes on to explain at length. The header is corrected here rather than in
-- place because Prisma records a checksum per applied migration and editing an applied file makes
-- `migrate deploy` fail on every database that already has it — a real operational hazard traded
-- for a comment. `packages/db/README.md` carries the same correction.

-- ---------------------------------------------------------------------------
-- The settlement marker
-- ---------------------------------------------------------------------------
ALTER TABLE "reminder_delivery_attempts"
  ADD COLUMN "schedule_settled_at" TIMESTAMPTZ(3);

-- Every terminal row that exists before this migration was written under the single-transaction
-- design, so its schedule was settled in the same commit by construction. Marking them settled is
-- therefore a statement of fact, not an assumption — and without it the settlement sweep would
-- wake up to a backlog of historical rows it would try to re-count.
--
-- `completed_at` is non-null on every terminal row (`completed_at_matches_outcome`, A8.3a), so the
-- COALESCE is belt-and-braces against a row that predates that constraint.
UPDATE "reminder_delivery_attempts"
  SET "schedule_settled_at" = COALESCE("completed_at", "created_at")
  WHERE "outcome" <> 'claimed';

-- A lease is not a result, so a `claimed` row has nothing to have settled. This is what makes retry
-- takeover safe to reason about: taking over a settled `retryable_failure` row *must* clear the
-- marker, and the database refuses the write if it forgets.
--
-- `NOT VALID` then `VALIDATE` so the existing-row scan runs under SHARE UPDATE EXCLUSIVE rather
-- than under the ACCESS EXCLUSIVE lock the bare `ADD CONSTRAINT` form holds for its whole scan.
-- Prisma wraps a migration file in one transaction, so the metadata-only ACCESS EXCLUSIVE from the
-- first statement is still held until commit; the split is worth having anyway because it is the
-- shape that becomes genuinely non-blocking the moment these are applied as separate steps, and
-- because the backfill above guarantees the validation finds nothing to reject.
ALTER TABLE "reminder_delivery_attempts"
  ADD CONSTRAINT "reminder_delivery_attempts_settlement_only_when_terminal"
  CHECK ("schedule_settled_at" IS NULL OR "outcome" <> 'claimed') NOT VALID;

ALTER TABLE "reminder_delivery_attempts"
  VALIDATE CONSTRAINT "reminder_delivery_attempts_settlement_only_when_terminal";

-- ---------------------------------------------------------------------------
-- Settlement-debt sweep (H1)
-- ---------------------------------------------------------------------------
--
-- Partial on exactly the sweep's predicate, so the index holds only the rows that are currently
-- owed a settlement — in steady state, none. A plain index on `schedule_settled_at` would grow with
-- all terminal history to answer a question about a set that is almost always empty.
CREATE INDEX "reminder_delivery_attempts_unsettled_idx"
  ON "reminder_delivery_attempts"("completed_at", "id")
  WHERE "schedule_settled_at" IS NULL AND "outcome" <> 'claimed';

-- ---------------------------------------------------------------------------
-- Retry-budget-exhaustion sweep (B2)
-- ---------------------------------------------------------------------------
--
-- The occurrence that crashed on its last permitted attempt before marking a provider call is
-- non-terminal, has no live lease once recovery releases it, and can never be claimed again — the
-- claim path refuses it with `retry_budget_exhausted`. Before this sweep existed the schedule stayed
-- active and armed and every later invocation re-scanned it forever.
--
-- The budget is a runtime policy number rather than a schema constant, so it is compared in the
-- query and the predicate carries only the parts that are structural: not yet terminal, and no
-- in-flight marker, because a marked row belongs to the ambiguous-recovery class instead.
CREATE INDEX "reminder_delivery_attempts_retry_budget_idx"
  ON "reminder_delivery_attempts"("attempt_count", "id")
  WHERE "outcome" IN ('claimed', 'retryable_failure') AND "provider_call_started_at" IS NULL;
