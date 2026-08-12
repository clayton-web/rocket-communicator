import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const a4Migration = readFileSync(
  path.join(root, 'prisma/migrations/20260713190000_a4_persistence_foundation/migration.sql'),
  'utf8',
);
const a5Migration = readFileSync(
  path.join(root, 'prisma/migrations/20260716140000_a5_gmail_persistence/migration.sql'),
  'utf8',
);

describe('A4 Prisma schema contracts', () => {
  it('stores capability token hashes and never raw tokens', () => {
    expect(schema).toMatch(/tokenHash/);
    expect(schema).toMatch(/token_hash/);
    expect(schema).not.toMatch(/\brawToken\b/);
    expect(schema).not.toMatch(/\btoken\s+String/);
    expect(a4Migration).toContain('token_hash');
    expect(a4Migration).not.toMatch(/\braw_token\b/);
  });

  it('persists explicit capability expiry and revocation fields', () => {
    expect(schema).toMatch(/expiresAt/);
    expect(schema).toMatch(/revokedAt/);
    expect(schema).toMatch(/revocationReason/);
    expect(schema).toMatch(/enum CapabilityStatus/);
    expect(schema).toContain('used');
  });

  it('scopes core tables by organizationId', () => {
    for (const model of [
      'Recipient',
      'Task',
      'TaskAssignment',
      'TaskNote',
      'TaskSuggestion',
      'TaskCapability',
      'AuditEvent',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema.match(/organizationId/g)?.length).toBeGreaterThan(5);
  });

  it('keeps dismissed as a lifecycle status without delete semantics', () => {
    expect(schema).toContain('dismissed');
    expect(schema).not.toMatch(/deletedAt/);
  });

  it('enables deny-by-default RLS in the foundation migration', () => {
    expect(a4Migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(a4Migration).toContain('audit_events');
    expect(a4Migration).toContain('task_capabilities');
  });

  it('does not invent Recipient auth/session tables', () => {
    expect(schema).not.toMatch(/model RecipientSession/);
    expect(schema).not.toMatch(/model RecipientAuth/);
    expect(schema).not.toMatch(/model RecipientAccount/);
  });

  it('allows assignment history with one active assignment via partial unique index', () => {
    // Scoped to the TaskAssignment model: other models legitimately hold a unique task_id — a Task
    // has at most one Reminder Schedule (D104) while it accumulates assignment history.
    const assignmentBlock = schema.match(
      /model TaskAssignment \{[\s\S]*?@@map\("task_assignments"\)/,
    )?.[0];
    expect(assignmentBlock).toBeDefined();
    expect(assignmentBlock).not.toMatch(/taskId\s+String\s+@unique/);
    expect(a4Migration).not.toContain('task_assignments_task_id_key');
    expect(a4Migration).toContain('task_assignments_task_id_idx');
    expect(a4Migration).toContain('task_assignments_one_active_per_task_idx');
    expect(a4Migration).toMatch(/WHERE\s+"cleared_at"\s+IS\s+NULL/);
  });
});

describe('A7 handoff Prisma schema contracts', () => {
  const a7Migration = readFileSync(
    path.join(root, 'prisma/migrations/20260718210000_a7_handoff_persistence/migration.sql'),
    'utf8',
  );

  it('defines HandoffAttempt and related enums', () => {
    expect(schema).toContain('model HandoffAttempt');
    expect(schema).toContain('enum HandoffDeliveryPath');
    expect(schema).toContain('enum HandoffAttemptStatus');
    expect(schema).toContain('enum HandoffIntent');
    expect(schema).toContain('enum CapabilityRevocationReason');
    expect(a7Migration).toContain('handoff_attempts');
    expect(a7Migration).toContain('CREATE TYPE "CapabilityRevocationReason"');
  });

  it('enforces one active capability per assignment via partial unique index', () => {
    expect(a7Migration).toContain('task_capabilities_one_active_per_assignment_idx');
    expect(a7Migration).toMatch(/WHERE\s+"status"\s*=\s*'active'/);
  });

  it('scopes idempotency uniquely by organizationId + idempotencyKey', () => {
    expect(schema).toContain('@@unique([organizationId, idempotencyKey])');
    expect(a7Migration).toContain('handoff_attempts_organization_id_idempotency_key_key');
  });

  it('adds actionableAt and typed revocation reasons', () => {
    expect(schema).toContain('actionableAt');
    expect(a7Migration).toContain('actionable_at');
    expect(schema).toContain('CapabilityRevocationReason');
  });

  it('uses partial unique for active Recipient emails', () => {
    expect(schema).not.toContain('@@unique([organizationId, email])');
    expect(a7Migration).toContain('recipients_one_active_email_per_org_idx');
    expect(a7Migration).toMatch(/WHERE\s+"active"\s*=\s*true/);
  });

  it('scopes provider message id uniquely by organization when set', () => {
    const hardeningMigration = readFileSync(
      path.join(
        root,
        'prisma/migrations/20260718223000_a7_handoff_concurrency_hardening/migration.sql',
      ),
      'utf8',
    );
    expect(hardeningMigration).toContain('handoff_attempts_org_provider_message_id_key');
    expect(hardeningMigration).toMatch(/WHERE\s+"provider_message_id"\s+IS\s+NOT\s+NULL/);
  });
});

describe('A5 Gmail Prisma schema contracts', () => {
  it('defines Gmail persistence models with ciphertext-only credentials', () => {
    for (const model of [
      'CommunicationAccount',
      'GmailOAuthCredential',
      'CommunicationEvent',
      'TemporaryCommunicationExcerpt',
      'GmailSyncRun',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain('encryptedRefreshToken');
    expect(schema).toContain('encryptedAccessToken');
    expect(schema).not.toMatch(/refreshToken\s+String/);
    expect(schema).not.toMatch(/accessToken\s+String/);
    expect(a5Migration).toContain('encrypted_refresh_token');
    expect(a5Migration).not.toMatch(/"refresh_token"/);
    expect(a5Migration).not.toMatch(/"access_token"/);
  });

  it('enforces one Gmail account per organization', () => {
    expect(schema).toContain('@@unique([organizationId, provider])');
    expect(a5Migration).toContain('communication_accounts_organization_id_provider_key');
  });

  it('defines sync lock columns on communication_accounts', () => {
    expect(schema).toContain('syncLockOwner');
    expect(schema).toContain('syncLockUntil');
    expect(a5Migration).toContain('"sync_lock_owner"');
    expect(a5Migration).toContain('"sync_lock_until"');
  });

  it('extends AuditActorKind with system and optional Gmail refs (D074)', () => {
    expect(schema).toMatch(/enum AuditActorKind/);
    expect(schema).toContain('system');
    expect(schema).toContain('communicationAccountId');
    expect(a5Migration).toContain("ADD VALUE 'system'");
  });

  it('enables deny-by-default RLS on A5 tables', () => {
    expect(a5Migration).toContain('ALTER TABLE "communication_accounts" ENABLE ROW LEVEL SECURITY');
    expect(a5Migration).toContain(
      'ALTER TABLE "gmail_oauth_credentials" ENABLE ROW LEVEL SECURITY',
    );
    expect(a5Migration).toContain('ALTER TABLE "communication_events" ENABLE ROW LEVEL SECURITY');
  });

  it('forbids raw MIME / attachment byte columns', () => {
    expect(schema).not.toMatch(/rawMime|mimeBytes|attachmentBytes|htmlBody|fullBody/);
    expect(a5Migration).not.toMatch(/raw_mime|mime_bytes|attachment_bytes|html_body|full_body/);
  });

  it('defines a single-use OAuth state model with hashed state and encrypted PKCE only', () => {
    expect(schema).toContain('model GmailOAuthState');
    expect(schema).toContain('stateHash');
    expect(schema).toContain('encryptedPkceVerifier');
    expect(schema).toContain('encryptionKeyVersion');
    expect(schema).toContain('consumedAt');
    expect(schema).not.toMatch(/codeVerifier/);
    expect(schema).not.toMatch(/GmailOAuthState[\s\S]*?(refreshToken|accessToken)\b/);
    expect(a5Migration).toContain('CREATE TABLE "gmail_oauth_states"');
    expect(a5Migration).toContain('"state_hash"');
    expect(a5Migration).toContain('"encrypted_pkce_verifier"');
    expect(a5Migration).toContain('gmail_oauth_states_state_hash_key');
    expect(a5Migration).not.toMatch(/"code_verifier"/);
    expect(a5Migration).not.toMatch(/gmail_oauth_states[\s\S]*?(refresh_token|access_token)/);
  });

  it('enables deny-by-default RLS on the OAuth state table', () => {
    expect(a5Migration).toContain('ALTER TABLE "gmail_oauth_states" ENABLE ROW LEVEL SECURITY');
  });
});

const a6Migration = readFileSync(
  path.join(root, 'prisma/migrations/20260717180000_a6_suggestion_persistence/migration.sql'),
  'utf8',
);

describe('A6 suggestion Prisma schema contracts', () => {
  it('adds nullable unique sourceCommunicationEventId without CommunicationEvent.suggestionId', () => {
    expect(schema).toContain('sourceCommunicationEventId');
    expect(schema).toContain('approvedTaskId');
    expect(a6Migration).toContain('source_communication_event_id');
    expect(a6Migration).toContain('approved_task_id');
    expect(a6Migration).toContain('task_suggestions_source_communication_event_id_key');
    expect(a6Migration).toContain('task_suggestions_approved_task_id_key');
    expect(schema).toMatch(/model CommunicationEvent \{[\s\S]*?@@map\("communication_events"\)/);
    const eventBlock = schema.match(
      /model CommunicationEvent \{[\s\S]*?@@map\("communication_events"\)/,
    )?.[0];
    expect(eventBlock).toBeDefined();
    expect(eventBlock).not.toMatch(/\bsuggestionId\b/);
    expect(a6Migration).not.toMatch(/communication_events[\s\S]*suggestion_id/);
  });

  it('adds SuggestionProcessingStatus and claim fields on CommunicationEvent', () => {
    expect(schema).toContain('enum SuggestionProcessingStatus');
    expect(schema).toContain('unprocessed');
    expect(schema).toContain('skipped_irrelevant');
    expect(schema).toContain('suggestion_created');
    expect(schema).toContain('failed_retryable');
    expect(schema).toContain('failed_permanent');
    expect(schema).toContain('suggestionProcessingStatus');
    expect(schema).toContain('suggestionClaimUntil');
    expect(schema).toContain('suggestionClaimOwner');
    expect(a6Migration).toContain('CREATE TYPE "SuggestionProcessingStatus"');
    expect(a6Migration).toContain("DEFAULT 'unprocessed'");
    expect(a6Migration).toContain('suggestion_claim_until');
  });

  it('keeps TemporaryCommunicationExcerpt.purgeAt required', () => {
    expect(schema).toMatch(/purgeAt\s+DateTime\s+@map\("purge_at"\)/);
    expect(a6Migration).not.toMatch(
      /temporary_communication_excerpts[\s\S]*purge_at.*DROP NOT NULL/i,
    );
  });
});

describe('InterpretationRun persistence schema contracts', () => {
  const interpretationMigration = readFileSync(
    path.join(
      root,
      'prisma/migrations/20260810210000_interpretation_run_persistence/migration.sql',
    ),
    'utf8',
  );

  it('defines InterpretationRun with org-scoped idempotency and successful outcomes only', () => {
    expect(schema).toContain('model InterpretationRun');
    expect(schema).toContain('enum InterpretationRunOutcome');
    expect(schema).toContain('proposals_created');
    expect(schema).toContain('no_proposals');
    expect(schema).toContain('@@unique([organizationId, idempotencyKey])');
    expect(interpretationMigration).toContain('CREATE TABLE "interpretation_runs"');
    expect(interpretationMigration).toContain(
      'interpretation_runs_organization_id_idempotency_key_key',
    );
  });

  it('keeps idempotencyKey, requestFingerprint, and requestId non-null', () => {
    const block = schema.match(
      /model InterpretationRun \{[\s\S]*?@@map\("interpretation_runs"\)/,
    )?.[0];
    expect(block).toBeDefined();
    expect(block).toMatch(/idempotencyKey\s+String\s+/);
    expect(block).toMatch(/requestFingerprint\s+String\s+/);
    expect(block).toMatch(/requestId\s+String\s+/);
    expect(block).not.toMatch(/idempotencyKey\s+String\?/);
    expect(block).not.toMatch(/requestFingerprint\s+String\?/);
    expect(block).not.toMatch(/requestId\s+String\?/);
    expect(interpretationMigration).toMatch(/"idempotency_key"\s+VARCHAR\(128\)\s+NOT NULL/);
    expect(interpretationMigration).toMatch(/"request_fingerprint"\s+VARCHAR\(128\)\s+NOT NULL/);
    expect(interpretationMigration).toMatch(/"request_id"\s+VARCHAR\(64\)\s+NOT NULL/);
  });

  it('enables deny-by-default RLS and does not alter existing tables', () => {
    expect(interpretationMigration).toContain(
      'ALTER TABLE "interpretation_runs" ENABLE ROW LEVEL SECURITY',
    );
    expect(interpretationMigration).not.toMatch(/CREATE POLICY/i);
    const altered = [...interpretationMigration.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(altered)).toEqual(new Set(['interpretation_runs']));
    expect(interpretationMigration).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(interpretationMigration).not.toMatch(/\bDELETE\b\s+FROM/i);
  });
});

describe('TaskSuggestion revision persistence schema contracts', () => {
  const revisionMigration = readFileSync(
    path.join(
      root,
      'prisma/migrations/20260810220000_task_suggestion_revision_persistence/migration.sql',
    ),
    'utf8',
  );

  it('defines TaskSuggestionRevision with authorKind and revision numbering only', () => {
    expect(schema).toContain('model TaskSuggestionRevision');
    expect(schema).toContain('enum TaskSuggestionRevisionAuthorKind');
    expect(schema).toContain('@@unique([suggestionId, revisionNumber])');
    expect(revisionMigration).toContain('CREATE TABLE "task_suggestion_revisions"');
    expect(revisionMigration).toContain(
      'task_suggestion_revisions_suggestion_id_revision_number_key',
    );
    expect(revisionMigration).toContain('task_suggestion_revisions_org_suggestion_revision_idx');
    expect(revisionMigration).toContain('revision_number_non_negative');
  });

  it('keeps TaskSuggestion free of acceptedRevisionId and does not alter existing tables', () => {
    const suggestionBlock = schema.match(
      /model TaskSuggestion \{[\s\S]*?@@map\("task_suggestions"\)/,
    )?.[0];
    expect(suggestionBlock).toBeDefined();
    expect(suggestionBlock).not.toContain('acceptedRevisionId');
    expect(revisionMigration).toContain(
      'ALTER TABLE "task_suggestion_revisions" ENABLE ROW LEVEL SECURITY',
    );
    expect(revisionMigration).not.toMatch(/CREATE POLICY/i);
    const altered = [...revisionMigration.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(altered)).toEqual(new Set(['task_suggestion_revisions']));
    expect(revisionMigration).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(revisionMigration).not.toMatch(/\bDELETE\b\s+FROM/i);
    expect(revisionMigration).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
  });
});

describe('D168 responsibility-selection evidence schema contracts', () => {
  const selectionMigration = readFileSync(
    path.join(
      root,
      'prisma/migrations/20260811190000_responsibility_selection_evidence/migration.sql',
    ),
    'utf8',
  );

  it('defines the evidence carrier beside TaskSuggestionRevision as its own axis', () => {
    expect(schema).toContain('model TaskSuggestionResponsibilitySelection');
    expect(schema).toContain('enum ResponsibilitySelectionPartyKind');
    expect(selectionMigration).toContain(
      'CREATE TABLE "task_suggestion_responsibility_selections"',
    );
    expect(selectionMigration).toContain(
      'task_suggestion_responsibility_selections_suggestion_id_key',
    );
    expect(selectionMigration).toContain('task_suggestion_responsibility_selections_task_id_key');
    expect(selectionMigration).toContain(
      'task_suggestion_responsibility_selections_party_kind_recipient',
    );

    // Responsibility selection and accepted content revision stay independent: neither carrier
    // references the other.
    const selectionBlock = schema.match(
      /model TaskSuggestionResponsibilitySelection \{[\s\S]*?@@map\("task_suggestion_responsibility_selections"\)/,
    )?.[0];
    expect(selectionBlock).toBeDefined();
    expect(selectionBlock).not.toContain('revision');
  });

  it('keeps responsibility, assignee, and custody off Task and adds no Owner assignment', () => {
    const taskBlock = schema.match(/model Task \{[\s\S]*?@@map\("tasks"\)/)?.[0];
    expect(taskBlock).toBeDefined();
    expect(taskBlock).not.toMatch(/^\s*assigneeId/m);
    expect(taskBlock).not.toMatch(/^\s*custody/m);
    expect(taskBlock).not.toMatch(/^\s*responsibleParty/m);
    expect(selectionMigration).not.toMatch(/ALTER TABLE "tasks"/);
    expect(selectionMigration).not.toMatch(/ALTER TABLE "task_assignments"/);
    expect(selectionMigration).not.toMatch(/\bINSERT\b\s+INTO\s+"/i);
  });

  it('enables deny-by-default RLS and alters only its own table', () => {
    expect(selectionMigration).toContain(
      'ALTER TABLE "task_suggestion_responsibility_selections" ENABLE ROW LEVEL SECURITY',
    );
    expect(selectionMigration).not.toMatch(/CREATE POLICY/i);
    const altered = [...selectionMigration.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(altered)).toEqual(new Set(['task_suggestion_responsibility_selections']));
    expect(selectionMigration).not.toMatch(/\bUPDATE\b\s+"/i);
    expect(selectionMigration).not.toMatch(/\bDELETE\b\s+FROM/i);
  });
});

describe('A8.3a reminder persistence schema contracts', () => {
  const a8Migration = readFileSync(
    path.join(root, 'prisma/migrations/20260731040000_a8_reminder_persistence/migration.sql'),
    'utf8',
  );

  it('defines the two durable reminder concepts required by D109', () => {
    expect(schema).toContain('model TaskReminderSchedule');
    expect(schema).toContain('model ReminderDeliveryAttempt');
    expect(a8Migration).toContain('CREATE TABLE "task_reminder_schedules"');
    expect(a8Migration).toContain('CREATE TABLE "reminder_delivery_attempts"');
  });

  it('defines the reminder enums', () => {
    for (const name of [
      'ReminderScheduleStatus',
      'ReminderScheduleStopReason',
      'ReminderAdvanceDisposition',
      'ReminderOccurrenceKind',
      'ReminderDeliveryOutcome',
      'ReminderSkipReason',
    ]) {
      expect(schema).toContain(`enum ${name}`);
      expect(a8Migration).toContain(`CREATE TYPE "${name}"`);
    }
  });

  it('stores local dates as text, never as DATE or DateTime (D103)', () => {
    const scheduleBlock = schema.match(
      /model TaskReminderSchedule \{[\s\S]*?@@map\("task_reminder_schedules"\)/,
    )?.[0];
    expect(scheduleBlock).toBeDefined();
    // A DATE column surfaces as a Prisma DateTime, which is the instant-vs-calendar-date confusion
    // D103 exists to remove.
    expect(scheduleBlock).toMatch(/dueLocalDate\s+String/);
    expect(scheduleBlock).toMatch(/advanceOccurrenceLocalDate\s+String/);
    expect(scheduleBlock).not.toMatch(/LocalDate\s+DateTime/);
    expect(a8Migration).toContain('"due_local_date" VARCHAR(10)');
    expect(a8Migration).not.toMatch(/"due_local_date"\s+DATE\b/);
  });

  it('adds tasks.due_local_date without backfilling historical due dates (D109)', () => {
    expect(schema).toMatch(/dueLocalDate\s+String\?\s+@map\("due_local_date"\)/);
    expect(a8Migration).toContain('ALTER TABLE "tasks" ADD COLUMN "due_local_date" VARCHAR(10)');
    // A backfill from due_at would silently activate reminders on every historical Task.
    expect(a8Migration).not.toMatch(/UPDATE "tasks"[\s\S]*due_local_date/);
  });

  it('enforces one Reminder Schedule per Task (D104)', () => {
    expect(schema).toMatch(/taskId\s+String\s+@unique\s+@map\("task_id"\)/);
    expect(a8Migration).toContain('task_reminder_schedules_task_id_key');
  });

  it('enforces server-derived occurrence idempotency in the database, not application code (D109)', () => {
    expect(schema).toContain(
      '@@unique([scheduleId, generation, occurrenceKind, occurrenceLocalDate])',
    );
    expect(a8Migration).toContain('reminder_delivery_attempts_occurrence_identity_key');
    // There is deliberately no caller-supplied idempotency key to forge.
    const attemptBlock = schema.match(
      /model ReminderDeliveryAttempt \{[\s\S]*?@@map\("reminder_delivery_attempts"\)/,
    )?.[0];
    expect(attemptBlock).not.toMatch(/idempotencyKey/);
  });

  it('enforces at most one successful delivery per local calendar day (D106)', () => {
    expect(a8Migration).toContain('reminder_delivery_attempts_one_success_per_local_day_idx');
    expect(a8Migration).toMatch(/WHERE\s+"outcome"\s*=\s*'success'/);
  });

  it('bounds the per-generation overdue count and keeps generations monotonic (D104, D106)', () => {
    expect(a8Migration).toContain('task_reminder_schedules_overdue_delivered_count_bounded');
    expect(a8Migration).toContain('task_reminder_schedules_generation_positive');
  });

  it('indexes the lookups a future worker needs', () => {
    expect(a8Migration).toContain('task_reminder_schedules_org_status_next_overdue_idx');
    expect(a8Migration).toContain('task_reminder_schedules_claim_expires_at_idx');
    expect(a8Migration).toContain('reminder_delivery_attempts_schedule_generation_outcome_idx');
  });

  it('stores no capability token, capability URL, or message content (D109, D114)', () => {
    // Field declarations only. The doc comments deliberately discuss what must never be stored, and
    // matching prose would make the guard fail for saying the right thing.
    const fieldsOnly = [
      schema.match(/model TaskReminderSchedule \{[\s\S]*?@@map\("task_reminder_schedules"\)/)?.[0],
      schema.match(
        /model ReminderDeliveryAttempt \{[\s\S]*?@@map\("reminder_delivery_attempts"\)/,
      )?.[0],
    ]
      .join('\n')
      .replace(/^\s*\/\/\/.*$/gm, '');
    expect(fieldsOnly).not.toMatch(/token|capabilityUrl|capability_url|body|subject|rawMime/i);

    const migrationStatements = a8Migration.replace(/^\s*--.*$/gm, '');
    expect(migrationStatements).not.toMatch(/token|capability_url|message_body|subject/i);
  });

  it('enables deny-by-default RLS on both reminder tables', () => {
    expect(a8Migration).toContain(
      'ALTER TABLE "task_reminder_schedules" ENABLE ROW LEVEL SECURITY',
    );
    expect(a8Migration).toContain(
      'ALTER TABLE "reminder_delivery_attempts" ENABLE ROW LEVEL SECURITY',
    );
  });

  it('introduces no second pause control alongside Waiting (D097, D107)', () => {
    const statusBlock = schema.match(/enum ReminderScheduleStatus \{[\s\S]*?\}/)?.[0];
    expect(statusBlock).toBeDefined();
    expect(statusBlock).toContain('suspended_waiting');
    expect(statusBlock).not.toMatch(/\bpaused\b|\bsnoozed\b|\bdelayed\b/);
  });
});
