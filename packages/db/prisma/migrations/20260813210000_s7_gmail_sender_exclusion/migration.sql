-- ---------------------------------------------------------------------------
-- S7 Gmail sender exclusion (D180)
-- ---------------------------------------------------------------------------
--
-- Additive and Gmail-specific. One organization-scoped preference row per normalized Gmail
-- sender address. Not a generic communication-source exclusion framework, not a Recipient
-- record, not an AuditEvent, and not a CommunicationEvent flag.
--
-- sender_address is the existing Gmail-ingestion normalized From representation. The row
-- contains no message body or excerpt and may outlive TemporaryCommunicationExcerpt and the
-- original occurrence. A5 ingestion is unaffected.
--
-- Deny-by-default PostgREST access (D006 defence in depth). No policies = deny for non-bypass
-- roles.

CREATE TABLE "gmail_sender_exclusions" (
    "id"                   VARCHAR(64) NOT NULL,
    "organization_id"      VARCHAR(64) NOT NULL,
    "sender_address"       VARCHAR(320) NOT NULL,
    "created_by_owner_id"  VARCHAR(64) NOT NULL,
    "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_sender_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gmail_sender_exclusions_organization_id_sender_address_key"
  ON "gmail_sender_exclusions"("organization_id", "sender_address");

CREATE INDEX "gmail_sender_exclusions_organization_id_idx"
  ON "gmail_sender_exclusions"("organization_id");

ALTER TABLE "gmail_sender_exclusions" ENABLE ROW LEVEL SECURITY;
