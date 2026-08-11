-- ---------------------------------------------------------------------------
-- TaskSuggestion revision-evidence persistence foundation (D155)
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Creates one enum type and one table. Alters no existing table,
-- drops nothing, rewrites no row, backfills nothing, and fabricates no historical revision rows.
-- Existing TaskSuggestions receive ZERO revision rows.
--
-- This is an inert storage foundation: no application producer writes revision rows yet.
-- TaskSuggestion remains the mutable operational/current proposal head. Revision rows are dormant
-- evidence only and must not influence AI behaviour, personalization, prompts, assignment, or
-- online learning.
--
-- Revision numbering: revision_number >= 0. Revision 0 means the first revision Rocket actually
-- recorded for this suggestion — not inherently AI. A future AI-created suggestion may record
-- revision 0 as author_kind = 'ai'; a legacy suggestion whose first recorded evidence is an Owner
-- correction may legitimately begin with revision 0 as author_kind = 'owner'. Absence of revisions
-- does not mean absence of a proposal.
--
-- Unique (suggestion_id, revision_number) is numbering protection, NOT immutability protection.
-- Rewrite/delete prevention is application-layer (create/read-only repository + source guard).
-- No SQL trigger or RULE is introduced here.
--
-- What is deliberately NOT here
--
--   * No authored_by_owner_id (single-Owner product; author_kind suffices for D155 now).
--   * No updated_at, status, accepted flag, or accepted_revision_id on task_suggestions.
--   * No interpretation_run_id / TaskSuggestion → InterpretationRun linkage.
--   * No people_hints, deadline_expression, proposed_recipient_hint.
--   * No prompt/model/policy metadata, provider payload, confidence/reasoning.
--   * No audit_event_id, source_reference, voice_originated.
--   * No changed-fields/diff metadata, retention metadata, or learning/personalization metadata.
--   * No backfill synthesizing revision 0 from the current mutable TaskSuggestion head.
--   * No A6 producer wiring, Owner-edit capture, or accepted-revision persistence.

-- ---------------------------------------------------------------------------
-- Enum type
-- ---------------------------------------------------------------------------

CREATE TYPE "TaskSuggestionRevisionAuthorKind" AS ENUM (
  'ai',
  'owner'
);

-- ---------------------------------------------------------------------------
-- task_suggestion_revisions
-- ---------------------------------------------------------------------------

CREATE TABLE "task_suggestion_revisions" (
    "id"                    VARCHAR(64) NOT NULL,
    "organization_id"       VARCHAR(64) NOT NULL,
    "suggestion_id"         VARCHAR(64) NOT NULL,
    "revision_number"       INTEGER NOT NULL,
    "author_kind"           "TaskSuggestionRevisionAuthorKind" NOT NULL,
    "summary_points"        JSONB NOT NULL,
    "proposed_due_at"       TIMESTAMPTZ(3),
    "proposed_priority"     "TaskPriority",
    "proposed_recipient_id" VARCHAR(64),
    "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_suggestion_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_suggestion_revisions_revision_number_non_negative"
      CHECK ("revision_number" >= 0)
);

-- Evidence without its suggestion is meaningless. RESTRICT rather than CASCADE so deleting a
-- suggestion that has recorded revision evidence cannot silently destroy that history.
ALTER TABLE "task_suggestion_revisions"
  ADD CONSTRAINT "task_suggestion_revisions_suggestion_id_fkey"
  FOREIGN KEY ("suggestion_id") REFERENCES "task_suggestions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Numbering protection within a suggestion (not immutability).
CREATE UNIQUE INDEX "task_suggestion_revisions_suggestion_id_revision_number_key"
  ON "task_suggestion_revisions"("suggestion_id", "revision_number");

-- Org-scoped ordered suggestion history reads.
CREATE INDEX "task_suggestion_revisions_org_suggestion_revision_idx"
  ON "task_suggestion_revisions"("organization_id", "suggestion_id", "revision_number");

-- Deny-by-default PostgREST access (D006 defence in depth). No policies = deny for non-bypass roles.
ALTER TABLE "task_suggestion_revisions" ENABLE ROW LEVEL SECURITY;
