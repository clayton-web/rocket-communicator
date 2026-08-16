-- ---------------------------------------------------------------------------
-- D082 Review excerpt retention linkage on TaskSuggestion
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Adds one nullable column, one foreign key, and one index to
-- task_suggestions. Drops nothing, rewrites no existing row, and backfills nothing.
--
-- Why a second linkage exists
--
--   `source_communication_event_id` is A6 claimed-event *processing* linkage. It is unique because
--   A6 creates at most one suggestion per Gmail event, and A6 audit attribution reads it. It is not
--   the general "which temporary excerpt does this proposal keep alive" entitlement, and generalizing
--   it would either drop that unique constraint or force Owner Review proposals into a
--   0..1-per-event cardinality that D161 explicitly rejects.
--
--   `source_excerpt_id` is that entitlement, held per TaskSuggestion. Deliberately NOT unique: one
--   Owner Review of one Gmail message or one Google Messages occurrence may produce 0..N sibling
--   proposals, and D082 resolves the excerpt deadline from the maximum still-valid entitlement
--   across those siblings. Both linkages coexist unchanged; neither is derived from the other.
--
-- ON DELETE SET NULL
--
--   temporary_communication_excerpts already cascades from communication_events, so RESTRICT here
--   would turn that existing cascade into a failure rather than protect anything. With the excerpt
--   row gone there is also no retention entitlement left to express: derived summary points and
--   source metadata are what legitimately survive (D024).
--
--   Note that D082 purge is a content scrub — content emptied, purged_at stamped — not a row
--   delete, so ordinary retention never exercises this clause. A purged excerpt keeps its linkage
--   and is never restored.
--
-- No backfill is required
--
--   The column is permanently nullable, not transitional. Existing A6 Gmail suggestions and
--   Recipient work-request suggestions have no Review excerpt linkage and stay valid without one,
--   exactly as they stay valid without an interpretation_run_id.
--
--   Nothing needs backfilling from Review history either: the shared interpretation path that
--   produces Review proposals is gated on INTERPRETATION_AI_ENABLED, which is not set in
--   Production, so no Review-produced task_suggestions row exists there to link.
--
-- What is deliberately NOT here
--
--   * No change to source_communication_event_id, its unique index, or its foreign key.
--   * No change to the A6 claim/lease/process-state columns on communication_events.
--   * No change to temporary_communication_excerpts: purge_at stays a required concrete deadline
--     (D082) and no associated_at column is added -- the association instant is the proposal's own
--     created_at.
--   * No retention worker: A13 remains planned.
--   * No new table, so no new RLS surface.

-- ---------------------------------------------------------------------------
-- task_suggestions.source_excerpt_id
-- ---------------------------------------------------------------------------

ALTER TABLE "task_suggestions"
  ADD COLUMN "source_excerpt_id" VARCHAR(64);

ALTER TABLE "task_suggestions"
  ADD CONSTRAINT "task_suggestions_source_excerpt_id_fkey"
  FOREIGN KEY ("source_excerpt_id") REFERENCES "temporary_communication_excerpts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Org-scoped sibling-entitlement read: every proposal holding a D082 claim on one excerpt.
-- Non-unique by design: 0..N siblings (D161).
CREATE INDEX "task_suggestions_organization_id_source_excerpt_id_idx"
  ON "task_suggestions"("organization_id", "source_excerpt_id");
