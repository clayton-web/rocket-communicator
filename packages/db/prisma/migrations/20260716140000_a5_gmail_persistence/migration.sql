-- A5.1–A5.2 Gmail persistence foundation (D065–D077)
-- Forward-only. Do not apply to production from this chunk without Owner approval.
-- Server-side Prisma access only (D006). Deny-by-default RLS enabled without policies.
-- Rollback note: drop A5 tables/enums and remove AuditActorKind.system only after confirming
-- no dependent application rows; prefer restore-from-backup over unsafe down SQL.

-- Extend A4 audit actor model for scheduled Gmail polling (D074).
ALTER TYPE "AuditActorKind" ADD VALUE 'system';

CREATE TYPE "CommunicationProvider" AS ENUM ('gmail');
CREATE TYPE "CommunicationAccountStatus" AS ENUM (
  'pending',
  'connected',
  'needs_reauth',
  'resync_required',
  'disconnected',
  'error'
);
CREATE TYPE "GmailHistoryState" AS ENUM ('unset', 'valid', 'resync_required');
CREATE TYPE "GmailSyncTrigger" AS ENUM ('cron', 'manual', 'initial');
CREATE TYPE "GmailSyncOutcome" AS ENUM (
  'running',
  'succeeded',
  'partial',
  'retryable_failure',
  'permanent_failure',
  'skipped_locked',
  'needs_reauth',
  'resync_required'
);
CREATE TYPE "CommunicationEventStatus" AS ENUM ('active', 'purged');

ALTER TABLE "audit_events" ADD COLUMN "system_id" VARCHAR(64);
ALTER TABLE "audit_events" ADD COLUMN "communication_account_id" VARCHAR(64);
ALTER TABLE "audit_events" ADD COLUMN "communication_event_id" VARCHAR(64);
ALTER TABLE "audit_events" ADD COLUMN "gmail_sync_run_id" VARCHAR(64);

CREATE INDEX "audit_events_organization_id_communication_account_id_idx"
  ON "audit_events"("organization_id", "communication_account_id");

CREATE TABLE "communication_accounts" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "provider" "CommunicationProvider" NOT NULL,
    "email_address" VARCHAR(320) NOT NULL,
    "external_account_id" VARCHAR(256) NOT NULL,
    "status" "CommunicationAccountStatus" NOT NULL,
    "history_id" VARCHAR(128),
    "history_state" "GmailHistoryState" NOT NULL,
    "connected_at" TIMESTAMPTZ(3),
    "disconnected_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "last_error_at" TIMESTAMPTZ(3),
    "sync_lock_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "communication_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gmail_oauth_credentials" (
    "id" VARCHAR(64) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "encrypted_refresh_token" TEXT NOT NULL,
    "encrypted_access_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "granted_scopes" VARCHAR(512) NOT NULL,
    "token_type" VARCHAR(32),
    "encryption_key_version" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "gmail_oauth_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_events" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "provider_message_id" VARCHAR(256) NOT NULL,
    "provider_thread_id" VARCHAR(256) NOT NULL,
    "dedupe_key" VARCHAR(128) NOT NULL,
    "internal_date" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "from_address" VARCHAR(320) NOT NULL,
    "to_addresses" JSONB NOT NULL,
    "subject" VARCHAR(256),
    "snippet" VARCHAR(512),
    "label_ids" JSONB NOT NULL,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "attachment_metadata" JSONB NOT NULL,
    "status" "CommunicationEventStatus" NOT NULL,
    "ingest_run_id" VARCHAR(64),
    "purge_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "communication_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "temporary_communication_excerpts" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "communication_event_id" VARCHAR(64) NOT NULL,
    "content" VARCHAR(8192) NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "purge_at" TIMESTAMPTZ(3) NOT NULL,
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "temporary_communication_excerpts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gmail_sync_runs" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "trigger" "GmailSyncTrigger" NOT NULL,
    "outcome" "GmailSyncOutcome" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "history_id_before" VARCHAR(128),
    "history_id_after" VARCHAR(128),
    "messages_examined" INTEGER NOT NULL DEFAULT 0,
    "events_created" INTEGER NOT NULL DEFAULT 0,
    "events_updated" INTEGER NOT NULL DEFAULT 0,
    "messages_skipped" INTEGER NOT NULL DEFAULT 0,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "error_code" VARCHAR(64),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gmail_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "communication_accounts_organization_id_provider_key"
  ON "communication_accounts"("organization_id", "provider");
CREATE INDEX "communication_accounts_organization_id_status_idx"
  ON "communication_accounts"("organization_id", "status");
CREATE INDEX "communication_accounts_sync_lock_until_idx"
  ON "communication_accounts"("sync_lock_until");

CREATE UNIQUE INDEX "gmail_oauth_credentials_account_id_key"
  ON "gmail_oauth_credentials"("account_id");
CREATE INDEX "gmail_oauth_credentials_organization_id_idx"
  ON "gmail_oauth_credentials"("organization_id");

CREATE UNIQUE INDEX "communication_events_organization_id_provider_message_id_key"
  ON "communication_events"("organization_id", "provider_message_id");
CREATE UNIQUE INDEX "communication_events_organization_id_dedupe_key_key"
  ON "communication_events"("organization_id", "dedupe_key");
CREATE INDEX "communication_events_organization_id_internal_date_idx"
  ON "communication_events"("organization_id", "internal_date");
CREATE INDEX "communication_events_account_id_internal_date_idx"
  ON "communication_events"("account_id", "internal_date");
CREATE INDEX "communication_events_organization_id_purge_at_idx"
  ON "communication_events"("organization_id", "purge_at");

CREATE UNIQUE INDEX "temporary_communication_excerpts_communication_event_id_key"
  ON "temporary_communication_excerpts"("communication_event_id");
CREATE INDEX "temporary_communication_excerpts_organization_id_purge_at_idx"
  ON "temporary_communication_excerpts"("organization_id", "purge_at");

CREATE INDEX "gmail_sync_runs_organization_id_started_at_idx"
  ON "gmail_sync_runs"("organization_id", "started_at");
CREATE INDEX "gmail_sync_runs_account_id_started_at_idx"
  ON "gmail_sync_runs"("account_id", "started_at");

ALTER TABLE "gmail_oauth_credentials"
  ADD CONSTRAINT "gmail_oauth_credentials_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "communication_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_events"
  ADD CONSTRAINT "communication_events_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "communication_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "temporary_communication_excerpts"
  ADD CONSTRAINT "temporary_communication_excerpts_communication_event_id_fkey"
  FOREIGN KEY ("communication_event_id") REFERENCES "communication_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gmail_sync_runs"
  ADD CONSTRAINT "gmail_sync_runs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "communication_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "communication_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gmail_oauth_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "temporary_communication_excerpts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gmail_sync_runs" ENABLE ROW LEVEL SECURITY;
