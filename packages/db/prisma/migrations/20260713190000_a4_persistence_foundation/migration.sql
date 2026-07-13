-- A4 Phase 2 persistence foundation
-- Server-side Prisma access only (D006). Deny-by-default RLS enabled without policies
-- so Supabase anon/authenticated roles cannot read/write these tables via PostgREST.
-- Application authorization remains Owner session + capability checks (not RLS).

CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'waiting', 'completed', 'dismissed');
CREATE TYPE "TaskSuggestionStatus" AS ENUM ('pending', 'approved', 'dismissed', 'merged');
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
-- `used` is reserved in the enum to match contracts; A4 must not assign used transitions (D056).
CREATE TYPE "CapabilityStatus" AS ENUM ('active', 'revoked', 'expired', 'used');
CREATE TYPE "AssignmentDeliveryStatus" AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE "AuditActorKind" AS ENUM ('owner', 'capability');
CREATE TYPE "AuditOutcome" AS ENUM ('succeeded', 'denied', 'failed');

CREATE TABLE "recipients" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(256) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "relationship_label" VARCHAR(64),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reminder_preferences" JSONB,
    "assignment_categories" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "prior_actionable_status" "TaskStatus",
    "summary_points" JSONB NOT NULL,
    "source_reference" JSONB,
    "due_at" TIMESTAMPTZ(3),
    "waiting_until" TIMESTAMPTZ(3),
    "priority" "TaskPriority",
    "outcome" JSONB,
    "reminder" JSONB NOT NULL,
    "retention" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_assignments" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "recipient_id" VARCHAR(64) NOT NULL,
    "intended_recipient_email" VARCHAR(320) NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "assigned_by_owner_id" VARCHAR(64) NOT NULL,
    "assignment_approved_at" TIMESTAMPTZ(3),
    "allowed_capability_actions" JSONB NOT NULL,
    "capability_status" "CapabilityStatus",
    "delivery_status" "AssignmentDeliveryStatus",
    "active_capability_id" VARCHAR(64),
    "cleared_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_notes" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "attribution" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "task_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_suggestions" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "status" "TaskSuggestionStatus" NOT NULL,
    "summary_points" JSONB NOT NULL,
    "source_reference" JSONB,
    "proposed_recipient_id" VARCHAR(64),
    "proposed_due_at" TIMESTAMPTZ(3),
    "proposed_priority" "TaskPriority",
    "voice_originated" BOOLEAN NOT NULL DEFAULT false,
    "origin_task_id" VARCHAR(64),
    "merged_into_task_id" VARCHAR(64),
    "retention" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "task_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_capabilities" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "assignment_id" VARCHAR(64) NOT NULL,
    "recipient_id" VARCHAR(64),
    "intended_recipient_email" VARCHAR(320) NOT NULL,
    "scope" JSONB NOT NULL,
    "status" "CapabilityStatus" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revocation_reason" VARCHAR(256),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "task_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
    "id" VARCHAR(64) NOT NULL,
    "organization_id" VARCHAR(64) NOT NULL,
    "actor_kind" "AuditActorKind" NOT NULL,
    "owner_id" VARCHAR(64),
    "capability_id" VARCHAR(64),
    "assignment_id" VARCHAR(64),
    "task_id" VARCHAR(64),
    "suggestion_id" VARCHAR(64),
    "intended_recipient_email" VARCHAR(320),
    "action" VARCHAR(64) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "resource_version" INTEGER,
    "task_status" VARCHAR(32),
    "note" VARCHAR(2000),
    "request_id" VARCHAR(64),
    "correlation_id" VARCHAR(64),
    "attribution_label" VARCHAR(256),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recipients_organization_id_email_key" ON "recipients"("organization_id", "email");
CREATE INDEX "recipients_organization_id_idx" ON "recipients"("organization_id");

CREATE INDEX "tasks_organization_id_status_idx" ON "tasks"("organization_id", "status");
CREATE INDEX "tasks_organization_id_updated_at_idx" ON "tasks"("organization_id", "updated_at");

-- Lookup by task (active + historical). At most one active assignment per task is
-- enforced by the partial unique index below (`cleared_at IS NULL`), not a full-table UNIQUE on task_id.
CREATE INDEX "task_assignments_task_id_idx" ON "task_assignments"("task_id");
CREATE UNIQUE INDEX "task_assignments_one_active_per_task_idx"
  ON "task_assignments"("task_id")
  WHERE "cleared_at" IS NULL;
CREATE INDEX "task_assignments_organization_id_idx" ON "task_assignments"("organization_id");
CREATE INDEX "task_assignments_recipient_id_idx" ON "task_assignments"("recipient_id");

CREATE INDEX "task_notes_organization_id_task_id_idx" ON "task_notes"("organization_id", "task_id");
CREATE INDEX "task_notes_task_id_created_at_idx" ON "task_notes"("task_id", "created_at");

CREATE INDEX "task_suggestions_organization_id_status_idx" ON "task_suggestions"("organization_id", "status");
CREATE INDEX "task_suggestions_organization_id_origin_task_id_idx" ON "task_suggestions"("organization_id", "origin_task_id");

CREATE UNIQUE INDEX "task_capabilities_token_hash_key" ON "task_capabilities"("token_hash");
CREATE INDEX "task_capabilities_organization_id_task_id_idx" ON "task_capabilities"("organization_id", "task_id");
CREATE INDEX "task_capabilities_organization_id_status_expires_at_idx" ON "task_capabilities"("organization_id", "status", "expires_at");
CREATE INDEX "task_capabilities_assignment_id_idx" ON "task_capabilities"("assignment_id");

CREATE INDEX "audit_events_organization_id_recorded_at_idx" ON "audit_events"("organization_id", "recorded_at");
CREATE INDEX "audit_events_organization_id_task_id_idx" ON "audit_events"("organization_id", "task_id");
CREATE INDEX "audit_events_organization_id_capability_id_idx" ON "audit_events"("organization_id", "capability_id");
CREATE INDEX "audit_events_request_id_idx" ON "audit_events"("request_id");

ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_suggestions" ADD CONSTRAINT "task_suggestions_merged_into_task_id_fkey" FOREIGN KEY ("merged_into_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_capabilities" ADD CONSTRAINT "task_capabilities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_capabilities" ADD CONSTRAINT "task_capabilities_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "task_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_capabilities" ADD CONSTRAINT "task_capabilities_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deny-by-default PostgREST access (D006 defence in depth). No policies = deny for non-bypass roles.
ALTER TABLE "recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
