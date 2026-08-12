-- ---------------------------------------------------------------------------
-- Acceptance-time Owner responsibility-selection evidence (D168)
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Creates one enum type and one table. Alters no existing table,
-- adds no column to tasks / task_suggestions / task_assignments, drops nothing, rewrites no row,
-- and backfills nothing. Existing accepted proposals receive ZERO selection rows.
--
-- This carrier records exactly one thing: who the Owner affirmatively chose as the initially
-- responsible party when accepting a proposal. It is the settled D155-family representation of the
-- responsibility axis left unsettled by D155/D164, standing beside task_suggestion_revisions as an
-- independent evidence axis.
--
-- What this is NOT
--
--   * Not canonical Task state, current responsibility, or custody state. D164/D168 forbid a
--     responsibility, assignee, or custody column on tasks, and none is added here.
--   * Not a TaskAssignment, an Owner TaskAssignment, or a TaskAssignment replacement. Current
--     external assignment truth stays in task_assignments.
--   * Not delivery, capability, or handoff state. Those stay in task_capabilities /
--     handoff_attempts, and a later failed, pending, cancelled, cleared, or absent handoff must
--     never erase or falsify a recorded selection.
--   * Not a responsibility history stream or state machine, and not a current-responsibility
--     projection. Reassignment, clearing, and return-to-Owner remain TaskAssignment/handoff/audit
--     concerns. The unique keys below are what hold this to the initial acceptance decision.
--   * Not an AuditEvent replacement, and AuditEvent is not this evidence store.
--
-- Affirmative-selection integrity
--
--   party_kind is NOT NULL and explicit, so Owner selection is always an affirmative recorded
--   choice. Absence of a row, a NULL recipient_id, absence of a TaskAssignment, or a missing or
--   failed handoff must NEVER be read as evidence that the Owner selected Me (D155, D164).
--   The CHECK constraint below makes the two shapes mutually exclusive at the database:
--   owner selections carry no recipient, recipient selections must name one.
--
-- Cardinality
--
--   Unique suggestion_id and unique task_id express "exactly one initial responsibility-selection
--   record per successfully accepted proposal" (D168) and are what structurally prevent this table
--   accumulating into responsibility history or becoming mutable current-responsibility state.
--   They are NOT immutability protection: rewrite/delete prevention is application-layer
--   (create/read-only repository surface + source guard). No SQL trigger or RULE is introduced.
--
-- Retention: D155 Structured learning signals / durable workflow intelligence. This carrier must
-- not inherit TemporaryCommunicationExcerpt timers, Task content scrub semantics, or the
-- TaskAssignment delivery lifecycle.
--
-- What is deliberately NOT here
--
--   * No updated_at, status, lifecycle, superseding, or current-selection flag.
--   * No delivery/handoff/capability state or linkage.
--   * No audit_event_id or accepted-revision linkage.
--   * No reassignment, clearing, or return-to-Owner rows.
--   * No responsibility/assignee/custody column on tasks, and no Owner task_assignments row.
--   * No approved_task_id read-contract change and no learning/personalization metadata.

-- ---------------------------------------------------------------------------
-- Enum type
-- ---------------------------------------------------------------------------

CREATE TYPE "ResponsibilitySelectionPartyKind" AS ENUM (
  'owner',
  'recipient'
);

-- ---------------------------------------------------------------------------
-- task_suggestion_responsibility_selections
-- ---------------------------------------------------------------------------

CREATE TABLE "task_suggestion_responsibility_selections" (
    "id"                     VARCHAR(64) NOT NULL,
    "organization_id"        VARCHAR(64) NOT NULL,
    "suggestion_id"          VARCHAR(64) NOT NULL,
    "task_id"                VARCHAR(64) NOT NULL,
    "party_kind"             "ResponsibilitySelectionPartyKind" NOT NULL,
    "recipient_id"           VARCHAR(64),
    "selected_by_owner_id"   VARCHAR(64) NOT NULL,
    "selected_at"            TIMESTAMPTZ(3) NOT NULL,
    "created_at"             TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_suggestion_responsibility_selections_pkey" PRIMARY KEY ("id"),

    -- Owner and Recipient selections are mutually exclusive shapes. A recipient selection must
    -- name the selected Recipient; an Owner selection must not carry one, because "no recipient"
    -- is never itself the evidence — party_kind is.
    CONSTRAINT "task_suggestion_responsibility_selections_party_kind_recipient"
      CHECK (
        ("party_kind" = 'owner' AND "recipient_id" IS NULL)
        OR ("party_kind" = 'recipient' AND "recipient_id" IS NOT NULL)
      )
);

-- Evidence without its accepted proposal, canonical Task, or selected Recipient is meaningless.
-- RESTRICT rather than CASCADE so deleting any of them cannot silently destroy the Owner's
-- recorded selection.
ALTER TABLE "task_suggestion_responsibility_selections"
  ADD CONSTRAINT "task_suggestion_responsibility_selections_suggestion_id_fkey"
  FOREIGN KEY ("suggestion_id") REFERENCES "task_suggestions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_suggestion_responsibility_selections"
  ADD CONSTRAINT "task_suggestion_responsibility_selections_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_suggestion_responsibility_selections"
  ADD CONSTRAINT "task_suggestion_responsibility_selections_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one initial responsibility selection per accepted proposal, and per canonical Task.
CREATE UNIQUE INDEX "task_suggestion_responsibility_selections_suggestion_id_key"
  ON "task_suggestion_responsibility_selections"("suggestion_id");

CREATE UNIQUE INDEX "task_suggestion_responsibility_selections_task_id_key"
  ON "task_suggestion_responsibility_selections"("task_id");

-- Org-scoped evidence reads.
CREATE INDEX "task_suggestion_responsibility_selections_org_suggestion_idx"
  ON "task_suggestion_responsibility_selections"("organization_id", "suggestion_id");

-- Deny-by-default PostgREST access (D006/D166 defence in depth). No policies = deny for non-bypass
-- roles.
ALTER TABLE "task_suggestion_responsibility_selections" ENABLE ROW LEVEL SECURITY;
