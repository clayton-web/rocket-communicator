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
    expect(schema).not.toMatch(/taskId\s+String\s+@unique/);
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
