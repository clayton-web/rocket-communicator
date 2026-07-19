-- A7.3 handoff persistence foundation (D086–D094, D092)
-- Durable HandoffAttempt, capability actionability + revocation reasons,
-- one-active-capability partial unique, active Recipient email uniqueness.
-- Does not implement Gmail send. Deny-by-default RLS on new tables.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "CapabilityRevocationReason" AS ENUM (
  'superseded',
  'manual',
  'assignment_ended',
  'expired'
);

CREATE TYPE "HandoffDeliveryPath" AS ENUM ('gmail_forward', 'assignment_email');

CREATE TYPE "HandoffAttemptStatus" AS ENUM ('pending', 'sent', 'failed');

CREATE TYPE "HandoffIntent" AS ENUM (
  'initial',
  'retry_failed',
  'explicit_reforward',
  'reassignment'
);

CREATE TYPE "HandoffFailureCategory" AS ENUM (
  'validation',
  'authorization',
  'concurrency',
  'domain_conflict',
  'retryable_dependency',
  'not_found',
  'provider'
);

-- ---------------------------------------------------------------------------
-- Recipient: normalized email + active-only uniqueness (D087)
-- ---------------------------------------------------------------------------

ALTER TABLE "recipients" ADD COLUMN "email_normalized" VARCHAR(320);

UPDATE "recipients"
SET "email_normalized" = lower(btrim("email"))
WHERE "email_normalized" IS NULL;

ALTER TABLE "recipients" ALTER COLUMN "email_normalized" SET NOT NULL;

-- Replace full unique (org, email) with partial unique on active normalized emails.
-- Inactive historical rows may share a normalized email with a later active Recipient.
DROP INDEX IF EXISTS "recipients_organization_id_email_key";

CREATE UNIQUE INDEX "recipients_one_active_email_per_org_idx"
  ON "recipients"("organization_id", "email_normalized")
  WHERE "active" = true;

CREATE INDEX "recipients_organization_id_email_normalized_idx"
  ON "recipients"("organization_id", "email_normalized");

-- ---------------------------------------------------------------------------
-- Capability: actionableAt + typed revocation reason + one-active partial unique
-- ---------------------------------------------------------------------------

ALTER TABLE "task_capabilities" ADD COLUMN "actionable_at" TIMESTAMPTZ(3);

-- Legacy A4 capabilities were immediately actionable; backfill preserves A4 behaviour.
UPDATE "task_capabilities"
SET "actionable_at" = "issued_at"
WHERE "actionable_at" IS NULL AND "status" = 'active';

-- Map free-form legacy reasons into the A7.2 vocabulary before typing the column.
ALTER TABLE "task_capabilities" ADD COLUMN "revocation_reason_new" "CapabilityRevocationReason";

UPDATE "task_capabilities"
SET "revocation_reason_new" = CASE
  WHEN "revocation_reason" IS NULL THEN NULL
  WHEN lower("revocation_reason") IN ('superseded', 'reassignment', 'reforward', 're-forward') THEN 'superseded'::"CapabilityRevocationReason"
  WHEN lower("revocation_reason") IN ('manual', 'manual_revoke', 'owner_revoked', 'owner') THEN 'manual'::"CapabilityRevocationReason"
  WHEN lower("revocation_reason") IN ('assignment_ended', 'assignment_returned_to_owner', 'returned', 'cleared') THEN 'assignment_ended'::"CapabilityRevocationReason"
  WHEN lower("revocation_reason") IN ('expired', 'expiry') THEN 'expired'::"CapabilityRevocationReason"
  ELSE 'manual'::"CapabilityRevocationReason"
END;

ALTER TABLE "task_capabilities" DROP COLUMN "revocation_reason";
ALTER TABLE "task_capabilities" RENAME COLUMN "revocation_reason_new" TO "revocation_reason";

-- D086: at most one active capability per Assignment (race-safe).
CREATE UNIQUE INDEX "task_capabilities_one_active_per_assignment_idx"
  ON "task_capabilities"("assignment_id")
  WHERE "status" = 'active';

-- ---------------------------------------------------------------------------
-- HandoffAttempt (authoritative delivery lifecycle)
-- ---------------------------------------------------------------------------

CREATE TABLE "handoff_attempts" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "recipient_id" VARCHAR(64) NOT NULL,
    "assignment_id" VARCHAR(64) NOT NULL,
    "capability_id" VARCHAR(64) NOT NULL,
    "acknowledgement" VARCHAR(64) NOT NULL,
    "delivery_path" "HandoffDeliveryPath" NOT NULL,
    "status" "HandoffAttemptStatus" NOT NULL,
    "intent" "HandoffIntent" NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" VARCHAR(128) NOT NULL,
    "provider_message_id" VARCHAR(128),
    "provider_accepted_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(64),
    "failure_category" "HandoffFailureCategory",
    "failure_fingerprint" VARCHAR(128),
    "retryable" BOOLEAN,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "prior_attempt_id" VARCHAR(64),
    "root_attempt_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "handoff_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "handoff_attempts_attempt_count_positive"
      CHECK ("attempt_count" >= 1),
    CONSTRAINT "handoff_attempts_sent_requires_provider_message"
      CHECK (
        ("status" <> 'sent')
        OR ("provider_message_id" IS NOT NULL AND "provider_accepted_at" IS NOT NULL)
      ),
    CONSTRAINT "handoff_attempts_provider_message_only_when_sent"
      CHECK (
        ("provider_message_id" IS NULL AND "provider_accepted_at" IS NULL)
        OR ("status" = 'sent')
      )
);

CREATE UNIQUE INDEX "handoff_attempts_organization_id_idempotency_key_key"
  ON "handoff_attempts"("organization_id", "idempotency_key");

CREATE INDEX "handoff_attempts_organization_id_task_id_status_idx"
  ON "handoff_attempts"("organization_id", "task_id", "status");

CREATE INDEX "handoff_attempts_organization_id_status_updated_at_idx"
  ON "handoff_attempts"("organization_id", "status", "updated_at");

CREATE INDEX "handoff_attempts_assignment_id_idx"
  ON "handoff_attempts"("assignment_id");

CREATE INDEX "handoff_attempts_capability_id_idx"
  ON "handoff_attempts"("capability_id");

CREATE INDEX "handoff_attempts_provider_message_id_idx"
  ON "handoff_attempts"("provider_message_id");

ALTER TABLE "handoff_attempts"
  ADD CONSTRAINT "handoff_attempts_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handoff_attempts"
  ADD CONSTRAINT "handoff_attempts_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handoff_attempts"
  ADD CONSTRAINT "handoff_attempts_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handoff_attempts"
  ADD CONSTRAINT "handoff_attempts_capability_id_fkey"
  FOREIGN KEY ("capability_id") REFERENCES "task_capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "handoff_attempts" ENABLE ROW LEVEL SECURITY;
