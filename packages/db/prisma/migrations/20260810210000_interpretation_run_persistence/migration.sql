-- ---------------------------------------------------------------------------
-- InterpretationRun persistence foundation (D161)
-- ---------------------------------------------------------------------------
--
-- Additive and forward-only. Creates one enum type and one table. Alters no existing table,
-- drops nothing, rewrites no row, backfills nothing, and fabricates no historical
-- InterpretationRun rows.
--
-- This is an inert storage foundation: no application producer writes InterpretationRun rows yet.
-- A6 CommunicationEvent claim/lease/process-state remains the automated processing authority and
-- is untouched here.
--
-- What is deliberately NOT here
--
--   * No InterpretationTrigger / sourceKind enum (no producer yet; add when first producer wires).
--   * No raw_input / raw_input_purge_at / retention indexes (D162 producer slice; purge must exist
--     before a producer stores raw input; the 4096-character bound is not ratified here).
--   * No communication_event_id linkage (A6 is not retrofitted; provenance when a producer needs it).
--   * No TaskSuggestion FK, revision fields, acceptance outcomes, claim/lease, or failure states.
--   * No pending/running outcome — a failed provider call does not create a completed occurrence row.
--
-- Idempotency follows HandoffAttempt (D161): UNIQUE (organization_id, idempotency_key); same key +
-- same fingerprint is replay; same key + different fingerprint is IDEMPOTENCY_KEY_CONFLICT.
-- idempotency_key, request_fingerprint, and request_id are NOT NULL.

-- ---------------------------------------------------------------------------
-- Enum type
-- ---------------------------------------------------------------------------

CREATE TYPE "InterpretationRunOutcome" AS ENUM (
  'proposals_created',
  'no_proposals'
);

-- ---------------------------------------------------------------------------
-- interpretation_runs
-- ---------------------------------------------------------------------------

CREATE TABLE "interpretation_runs" (
    "id"                  VARCHAR(64) NOT NULL,
    "organization_id"     VARCHAR(64) NOT NULL,
    "idempotency_key"     VARCHAR(128) NOT NULL,
    "request_fingerprint" VARCHAR(128) NOT NULL,
    "outcome"             "InterpretationRunOutcome" NOT NULL,
    "model_version"       VARCHAR(64) NOT NULL,
    "policy_version"      VARCHAR(64) NOT NULL,
    "request_id"          VARCHAR(64) NOT NULL,
    "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interpretation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interpretation_runs_organization_id_idempotency_key_key"
  ON "interpretation_runs"("organization_id", "idempotency_key");

-- Deny-by-default PostgREST access (D006 defence in depth). No policies = deny for non-bypass roles.
ALTER TABLE "interpretation_runs" ENABLE ROW LEVEL SECURITY;
