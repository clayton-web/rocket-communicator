import { Prisma } from '../generated/client/index.js';
import type { DbClient, DbTransaction } from '../client/create-prisma-client.js';
import { toIso } from '../mappers/domain-mappers.js';
import { notFound } from '../errors/persistence-errors.js';

type Client = DbClient | DbTransaction;

export type GmailSenderExclusionRecord = {
  id: string;
  organizationId: string;
  senderAddress: string;
  createdByOwnerId: string;
  createdAt: string;
};

function mapGmailSenderExclusion(row: {
  id: string;
  organizationId: string;
  senderAddress: string;
  createdByOwnerId: string;
  createdAt: Date;
}): GmailSenderExclusionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    senderAddress: row.senderAddress,
    createdByOwnerId: row.createdByOwnerId,
    createdAt: toIso(row.createdAt),
  };
}

export function isGmailSenderExclusionUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function listGmailExcludedSenderAddresses(
  db: Client,
  organizationId: string,
): Promise<string[]> {
  const rows = await db.gmailSenderExclusion.findMany({
    where: { organizationId },
    select: { senderAddress: true },
  });
  return rows.map((row) => row.senderAddress);
}

export async function findGmailSenderExclusionByOrgAndAddress(
  db: Client,
  organizationId: string,
  senderAddress: string,
): Promise<GmailSenderExclusionRecord | null> {
  const row = await db.gmailSenderExclusion.findUnique({
    where: {
      organizationId_senderAddress: { organizationId, senderAddress },
    },
  });
  return row ? mapGmailSenderExclusion(row) : null;
}

export async function findGmailSenderExclusionById(
  db: Client,
  organizationId: string,
  exclusionId: string,
): Promise<GmailSenderExclusionRecord | null> {
  const row = await db.gmailSenderExclusion.findFirst({
    where: { id: exclusionId, organizationId },
  });
  return row ? mapGmailSenderExclusion(row) : null;
}

export async function createGmailSenderExclusion(
  db: Client,
  input: {
    id: string;
    organizationId: string;
    senderAddress: string;
    createdByOwnerId: string;
  },
): Promise<GmailSenderExclusionRecord> {
  const row = await db.gmailSenderExclusion.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      senderAddress: input.senderAddress,
      createdByOwnerId: input.createdByOwnerId,
    },
  });
  return mapGmailSenderExclusion(row);
}

export async function deleteGmailSenderExclusionById(
  db: Client,
  organizationId: string,
  exclusionId: string,
): Promise<GmailSenderExclusionRecord> {
  const existing = await findGmailSenderExclusionById(db, organizationId, exclusionId);
  if (!existing) {
    throw notFound('Gmail sender exclusion was not found.');
  }
  await db.gmailSenderExclusion.delete({
    where: { id: existing.id },
  });
  return existing;
}
