import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  path.join(root, 'prisma/migrations/20260713190000_a4_persistence_foundation/migration.sql'),
  'utf8',
);

describe('A4 Prisma schema contracts', () => {
  it('stores capability token hashes and never raw tokens', () => {
    expect(schema).toMatch(/tokenHash/);
    expect(schema).toMatch(/token_hash/);
    expect(schema).not.toMatch(/\brawToken\b/);
    expect(schema).not.toMatch(/\btoken\s+String/);
    expect(migration).toContain('token_hash');
    expect(migration).not.toMatch(/\braw_token\b/);
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
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('audit_events');
    expect(migration).toContain('task_capabilities');
  });

  it('does not invent Recipient auth/session tables', () => {
    expect(schema).not.toMatch(/model RecipientSession/);
    expect(schema).not.toMatch(/model RecipientAuth/);
    expect(schema).not.toMatch(/model RecipientAccount/);
  });

  it('allows assignment history with one active assignment via partial unique index', () => {
    expect(schema).not.toMatch(/taskId\s+String\s+@unique/);
    expect(migration).not.toContain('task_assignments_task_id_key');
    expect(migration).toContain('task_assignments_task_id_idx');
    expect(migration).toContain('task_assignments_one_active_per_task_idx');
    expect(migration).toMatch(/WHERE\s+"cleared_at"\s+IS\s+NULL/);
  });
});
