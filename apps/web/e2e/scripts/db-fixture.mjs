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
 *   { "action": "stop-reminder-schedule", taskId, dueLocalDate, stopReason }
 *   { "action": "clear-reminder-schedules" }
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

      /**
       * A stopped Reminder Schedule flagged for Owner attention, for the A8.6a `/attention` page.
       *
       * No Owner HTTP surface can produce this state, and no permitted action can either: the
       * attention flag is raised only by the A8.4b reminder worker settling an occurrence, which
       * requires `ENABLE_REMINDER_DELIVERY` and a real send. Seeding the row is what lets the
       * browser harness exercise the populated page and its accessibility scan against real
       * database rows, with no flag enabled, no worker run, and no injected markup.
       *
       * Writes the schedule directly rather than through the establishment repository because that
       * path deliberately refuses to create an already-stopped generation.
       */
      case 'stop-reminder-schedule': {
        const stoppedAt = new Date();
        await db.task.update({
          where: { id: command.taskId },
          data: { dueLocalDate: command.dueLocalDate },
        });
        await db.taskReminderSchedule.create({
          data: {
            id: `sched_e2e_${randomUUID()}`.slice(0, 64),
            organizationId: ORGANIZATION_ID,
            taskId: command.taskId,
            dueLocalDate: command.dueLocalDate,
            schedulingTimeZone: 'America/Vancouver',
            establishedAt: stoppedAt,
            status: 'stopped',
            stopReason: command.stopReason,
            stoppedAt,
            requiresOwnerAttention: true,
            advanceDisposition: 'skipped_window_elapsed',
            advanceOccurrenceLocalDate: command.dueLocalDate,
            advanceOccurrenceAt: stoppedAt,
          },
        });
        return { stopped: true };
      }

      /*
       * Delete every Reminder Schedule in the organization.
       *
       * The harness migrates the local database but never truncates it, so rows survive between
       * runs and every other spec copes by filtering on a unique label. The `/attention` page
       * cannot: its empty state and its single-item state are assertions about the *whole* list,
       * and one seeded row from a previous run would make "nothing needs attention" unprovable
       * forever. Clearing first lets each test state the precondition it actually needs.
       */
      case 'clear-reminder-schedules': {
        const { count } = await db.taskReminderSchedule.deleteMany({
          where: { organizationId: ORGANIZATION_ID },
        });
        return { deleted: count };
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
