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
});
