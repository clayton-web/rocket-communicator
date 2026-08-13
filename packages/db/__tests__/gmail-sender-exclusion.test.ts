import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistGmailSenderExclusion,
  removeGmailSenderExclusion,
  findGmailSenderExclusionByOrgAndAddress,
} from '../src/index.js';
import { createTestDatabase, type TestDatabase } from '../src/client/create-test-database.js';

const orgA = 'org_gsex_a';
const orgB = 'org_gsex_b';
const now = '2026-08-13T21:00:00.000Z';

function ownerAudit(
  id: string,
  organizationId: string,
  ownerId: string,
  action: 'gmail_sender_excluded' | 'gmail_sender_exclusion_removed',
) {
  return {
    id,
    organizationId,
    actorKind: 'owner' as const,
    ownerId,
    action,
    outcome: 'succeeded' as const,
    recordedAt: now,
  };
}

describe('Gmail sender exclusion persistence (D180)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('scopes uniqueness to organization + normalized sender address', async () => {
    const first = await persistGmailSenderExclusion({
      db: db.prisma,
      exclusion: {
        id: 'gsex_a_alice',
        organizationId: orgA,
        senderAddress: 'alice@example.com',
        createdByOwnerId: 'owner_a',
      },
      audit: ownerAudit('audit_gsex_a1', orgA, 'owner_a', 'gmail_sender_excluded'),
    });
    expect(first.created).toBe(true);

    const again = await persistGmailSenderExclusion({
      db: db.prisma,
      exclusion: {
        id: 'gsex_a_alice_again',
        organizationId: orgA,
        senderAddress: 'alice@example.com',
        createdByOwnerId: 'owner_a',
      },
      audit: ownerAudit('audit_gsex_a1b', orgA, 'owner_a', 'gmail_sender_excluded'),
    });
    expect(again.created).toBe(false);
    expect(again.exclusion.id).toBe('gsex_a_alice');

    const otherOrg = await persistGmailSenderExclusion({
      db: db.prisma,
      exclusion: {
        id: 'gsex_b_alice',
        organizationId: orgB,
        senderAddress: 'alice@example.com',
        createdByOwnerId: 'owner_b',
      },
      audit: ownerAudit('audit_gsex_b1', orgB, 'owner_b', 'gmail_sender_excluded'),
    });
    expect(otherOrg.created).toBe(true);
    expect(otherOrg.exclusion.id).toBe('gsex_b_alice');

    const foundA = await findGmailSenderExclusionByOrgAndAddress(
      db.prisma,
      orgA,
      'alice@example.com',
    );
    const foundB = await findGmailSenderExclusionByOrgAndAddress(
      db.prisma,
      orgB,
      'alice@example.com',
    );
    expect(foundA?.id).toBe('gsex_a_alice');
    expect(foundB?.id).toBe('gsex_b_alice');
    expect(
      await db.prisma.gmailSenderExclusion.count({
        where: { senderAddress: 'alice@example.com' },
      }),
    ).toBe(2);
  });

  it('removes an exclusion without leaving the row', async () => {
    await persistGmailSenderExclusion({
      db: db.prisma,
      exclusion: {
        id: 'gsex_remove_me',
        organizationId: orgA,
        senderAddress: 'remove@example.com',
        createdByOwnerId: 'owner_a',
      },
      audit: ownerAudit('audit_gsex_rm1', orgA, 'owner_a', 'gmail_sender_excluded'),
    });

    const removed = await removeGmailSenderExclusion({
      db: db.prisma,
      organizationId: orgA,
      exclusionId: 'gsex_remove_me',
      audit: ownerAudit('audit_gsex_rm2', orgA, 'owner_a', 'gmail_sender_exclusion_removed'),
    });
    expect(removed.id).toBe('gsex_remove_me');
    expect(
      await findGmailSenderExclusionByOrgAndAddress(db.prisma, orgA, 'remove@example.com'),
    ).toBeNull();
  });

  it('does not let one organization remove another organization exclusion', async () => {
    await persistGmailSenderExclusion({
      db: db.prisma,
      exclusion: {
        id: 'gsex_b_only',
        organizationId: orgB,
        senderAddress: 'only-b@example.com',
        createdByOwnerId: 'owner_b',
      },
      audit: ownerAudit('audit_gsex_b_only', orgB, 'owner_b', 'gmail_sender_excluded'),
    });

    await expect(
      removeGmailSenderExclusion({
        db: db.prisma,
        organizationId: orgA,
        exclusionId: 'gsex_b_only',
        audit: ownerAudit('audit_gsex_steal', orgA, 'owner_a', 'gmail_sender_exclusion_removed'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(
      await findGmailSenderExclusionByOrgAndAddress(db.prisma, orgB, 'only-b@example.com'),
    ).not.toBeNull();
  });
});
