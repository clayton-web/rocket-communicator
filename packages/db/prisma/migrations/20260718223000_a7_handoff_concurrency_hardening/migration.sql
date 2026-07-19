-- A7.3 concurrency hardening: provider message id uniqueness within organization.
-- Prevents one Gmail acceptance from finalizing two different handoff attempts.
-- Scoped by organization (one Owner Gmail mailbox per org under D094), not global.

CREATE UNIQUE INDEX "handoff_attempts_org_provider_message_id_key"
  ON "handoff_attempts"("organization_id", "provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;
