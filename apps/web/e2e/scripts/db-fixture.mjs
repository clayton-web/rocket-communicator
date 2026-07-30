#!/usr/bin/env node
/**
 * Fixture access to the disposable LOCAL database for the P1.2 browser harness (D119).
 *
 * Runs as a separate ESM process because the workspace packages are ESM-only while the
 * Playwright test loader is CommonJS. Keeping database access in one narrow, auditable
 * entry point also makes it obvious that the harness touches nothing else.
 *
 * Usage: node e2e/scripts/db-fixture.mjs '<json command>'
 * Commands:
 *   { "action": "attach-assignment", taskId, recipientId, recipientEmail, ownerId }
 *   { "action": "expire-capability", capabilityId }
 *   { "action": "read-task", taskId }
 *   { "action": "read-notes", taskId }
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asAssignmentId,
  asOwnerId,
  asRecipientId,
} from '@aicaa/domain';
import { createActiveAssignment, createPrismaClient } from '@aicaa/db';
import { assertLocalDatabaseUrl } from '../config/local-db-guard.mjs';

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const ORGANIZATION_ID = process.env.E2E_ORGANIZATION_ID;

async function main() {
  // Fail closed even when invoked directly: this script must never mutate a real database.
  assertLocalDatabaseUrl(DATABASE_URL, 'E2E_DATABASE_URL');
  if (!ORGANIZATION_ID) {
    throw new Error('E2E_ORGANIZATION_ID is required.');
  }

  const command = JSON.parse(process.argv[2] ?? '{}');
  const db = createPrismaClient(DATABASE_URL);

  try {
    switch (command.action) {
      case 'attach-assignment': {
        const assignmentId = randomUUID();
        const now = command.now ?? new Date().toISOString();
        await createActiveAssignment(db, ORGANIZATION_ID, command.taskId, {
          id: asAssignmentId(assignmentId),
          recipientId: asRecipientId(command.recipientId),
          intendedRecipientEmail: command.recipientEmail,
          assignedAt: now,
          assignedByOwnerId: asOwnerId(command.ownerId),
          assignmentApprovedAt: now,
          allowedCapabilityActions: [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE],
        });
        return { assignmentId };
      }

      case 'expire-capability': {
        await db.taskCapability.update({
          where: { id: command.capabilityId },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });
        return { expired: true };
      }

      case 'read-task': {
        const row = await db.task.findFirst({
          where: { id: command.taskId, organizationId: ORGANIZATION_ID },
          select: { status: true, version: true, outcome: true },
        });
        return row
          ? { status: String(row.status), version: Number(row.version), outcome: row.outcome }
          : null;
      }

      /**
       * Business-meaningful capability and assignment state for non-mutation assertions.
       *
       * Deliberately excludes `lastUsedAt` and `updatedAt`: the schema documents `lastUsedAt`
       * as an activity stamp that does not imply consumption (D056), so asserting on it would
       * fail for a legitimate access record rather than for a prohibited mutation.
       */
      case 'read-capability-state': {
        const row = await db.taskCapability.findFirst({
          where: { id: command.capabilityId, organizationId: ORGANIZATION_ID },
          select: {
            status: true,
            revokedAt: true,
            revocationReason: true,
            actionableAt: true,
            expiresAt: true,
            assignment: { select: { capabilityStatus: true, deliveryStatus: true } },
          },
        });
        return row
          ? {
              status: String(row.status),
              revokedAt: row.revokedAt?.toISOString() ?? null,
              revocationReason: row.revocationReason ? String(row.revocationReason) : null,
              actionableAt: row.actionableAt?.toISOString() ?? null,
              expiresAt: row.expiresAt.toISOString(),
              assignmentCapabilityStatus: row.assignment?.capabilityStatus
                ? String(row.assignment.capabilityStatus)
                : null,
              assignmentDeliveryStatus: row.assignment?.deliveryStatus
                ? String(row.assignment.deliveryStatus)
                : null,
            }
          : null;
      }

      case 'read-notes': {
        const rows = await db.taskNote.findMany({
          where: { taskId: command.taskId, organizationId: ORGANIZATION_ID },
          orderBy: { createdAt: 'asc' },
          select: { body: true, attribution: true },
        });
        return rows;
      }

      default:
        throw new Error(`Unknown fixture action "${command.action}".`);
    }
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((result) => {
    process.stdout.write(JSON.stringify({ ok: true, result }));
  })
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    process.exitCode = 1;
  });
