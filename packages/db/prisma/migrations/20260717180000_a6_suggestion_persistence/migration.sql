-- A6.1 suggestion persistence foundation (D080–D085)
-- Forward-only additive migration. Safe for existing Production A5 data.
-- Existing communication_events default to suggestion_processing_status = unprocessed.
-- Do not apply to Production from this chunk without Owner approval.

CREATE TYPE "SuggestionProcessingStatus" AS ENUM (
  'unprocessed',
  'skipped_irrelevant',
  'suggestion_created',
  'failed_retryable',
  'failed_permanent'
);

ALTER TABLE "communication_events"
  ADD COLUMN "suggestion_processing_status" "SuggestionProcessingStatus" NOT NULL DEFAULT 'unprocessed',
  ADD COLUMN "suggestion_processed_at" TIMESTAMPTZ(3),
  ADD COLUMN "suggestion_processing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "suggestion_last_error_code" VARCHAR(64),
  ADD COLUMN "suggestion_claim_until" TIMESTAMPTZ(3),
  ADD COLUMN "suggestion_claim_owner" VARCHAR(64),
  ADD COLUMN "suggestion_policy_version" VARCHAR(64);

CREATE INDEX "communication_events_suggestion_processing_status_suggestion_claim_until_idx"
  ON "communication_events"("suggestion_processing_status", "suggestion_claim_until");

CREATE INDEX "communication_events_organization_id_suggestion_processing_status_idx"
  ON "communication_events"("organization_id", "suggestion_processing_status");

-- Nullable source event link (D081). Unique when non-null enforces 0..1 suggestion per event.
-- CommunicationEvent.id is globally unique, so a single-column unique constraint is sufficient.
ALTER TABLE "task_suggestions"
  ADD COLUMN "source_communication_event_id" VARCHAR(64),
  ADD COLUMN "approved_task_id" VARCHAR(64);

CREATE UNIQUE INDEX "task_suggestions_source_communication_event_id_key"
  ON "task_suggestions"("source_communication_event_id");

CREATE UNIQUE INDEX "task_suggestions_approved_task_id_key"
  ON "task_suggestions"("approved_task_id");

ALTER TABLE "task_suggestions"
  ADD CONSTRAINT "task_suggestions_source_communication_event_id_fkey"
  FOREIGN KEY ("source_communication_event_id") REFERENCES "communication_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Durable Task ← approved suggestion link for D082 terminal excerpt retention.
ALTER TABLE "task_suggestions"
  ADD CONSTRAINT "task_suggestions_approved_task_id_fkey"
  FOREIGN KEY ("approved_task_id") REFERENCES "tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
