-- ---------------------------------------------------------------------------
-- InterpretationRun -> 0..N TaskSuggestion ownership edge (D161)
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Creates one enum type, adds one required column to the producer-less
-- interpretation_runs table, and adds one nullable column plus one foreign key and one index to
-- task_suggestions. Drops nothing, rewrites no existing row, and backfills nothing.
--
-- Still inert: no application producer writes interpretation_runs rows or sets
-- task_suggestions.interpretation_run_id. A6 CommunicationEvent claim/lease/process-state remains
-- the automated Gmail processing authority and is NOT retrofitted to create InterpretationRuns.
--
-- Cardinality (D161): one occurrence owns 0..N proposals, so the edge is a nullable FK on the
-- child and is deliberately NOT unique -- sibling proposals from the same occurrence must coexist.
-- Nullability is permanent, not transitional: existing A6 Gmail suggestions and Recipient
-- work-request suggestions have no interpretation occurrence and stay valid without one.
--
-- source_kind is required because an occurrence with undeclared provenance is not meaningful.
-- interpretation_runs has no producer and therefore no rows, so NOT NULL with no DEFAULT is safe
-- and fails loudly rather than fabricating provenance for pre-existing rows.
--
-- Representation is not authorization (D161): declaring a source kind authorizes no producer,
-- service, route, AI orchestration, Owner-review surface, automatic-processing change,
-- notification, cron, or Production flag.
--
-- What is deliberately NOT here
--
--   * No interpretation producer, service, route, or AI orchestration.
--   * No A6 retrofit: source_communication_event_id and its unique index are untouched, and no
--     historical suggestion is given an interpretation_run_id.
--   * No raw_input / raw_input_purge_at retention columns (D162 producer slice).
--   * No communication_event_id linkage on interpretation_runs.
--   * No proposal_count or other denormalized counter -- the foreign key is the grouping truth.
--   * No Owner-edit revision, accepted-revision, or acceptance-outcome columns.
--   * No Keep/Assign or responsibility-selection persistence.

-- ---------------------------------------------------------------------------
-- Enum type
-- ---------------------------------------------------------------------------

CREATE TYPE "InterpretationSourceKind" AS ENUM (
  'owner_manual_capture',
  'gmail'
);

-- ---------------------------------------------------------------------------
-- interpretation_runs.source_kind
-- ---------------------------------------------------------------------------

ALTER TABLE "interpretation_runs"
  ADD COLUMN "source_kind" "InterpretationSourceKind" NOT NULL;

-- ---------------------------------------------------------------------------
-- task_suggestions.interpretation_run_id
-- ---------------------------------------------------------------------------

ALTER TABLE "task_suggestions"
  ADD COLUMN "interpretation_run_id" VARCHAR(64);

-- Grouping truth without its occurrence is meaningless, and A6's existing source-event link
-- already uses RESTRICT. Deleting an occurrence that owns proposals must fail loudly rather than
-- silently detach them.
ALTER TABLE "task_suggestions"
  ADD CONSTRAINT "task_suggestions_interpretation_run_id_fkey"
  FOREIGN KEY ("interpretation_run_id") REFERENCES "interpretation_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Org-scoped "which proposals does this occurrence own" read. Non-unique by design: 0..N siblings.
CREATE INDEX "task_suggestions_organization_id_interpretation_run_id_idx"
  ON "task_suggestions"("organization_id", "interpretation_run_id");
