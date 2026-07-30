import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DATABASE_URL, E2E_ORGANIZATION_ID, assertLocalDatabaseUrl } from '../config/e2e-env';

/**
 * Fixture access to the disposable LOCAL database.
 *
 * Used only where no Owner HTTP surface exists for the fixture: attaching an active
 * assignment (the create-with-assignment service path was removed in A7.6/D091, and the
 * handoff path requires Gmail, which P1.2 excludes) and ageing a capability so the real
 * expiry branch is exercised. Also used for server-side assertions after Recipient actions.
 *
 * Delegates to an ESM child process because the workspace packages are ESM-only.
 */

const FIXTURE_SCRIPT = path.resolve(__dirname, '../scripts/db-fixture.mjs');

function runFixture<T>(command: Record<string, unknown>): T {
  assertLocalDatabaseUrl(E2E_DATABASE_URL);

  const stdout = execFileSync('node', [FIXTURE_SCRIPT, JSON.stringify(command)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_DATABASE_URL,
      E2E_ORGANIZATION_ID,
    },
  });

  const parsed = JSON.parse(stdout) as { ok: boolean; result?: T; error?: string };
  if (!parsed.ok) {
    throw new Error(`Database fixture failed: ${parsed.error}`);
  }
  return parsed.result as T;
}

/** Attach an active assignment so a Recipient capability can be issued for the Task. */
export function attachActiveAssignment(input: {
  taskId: string;
  recipientId: string;
  recipientEmail: string;
  ownerId: string;
}): { assignmentId: string } {
  return runFixture({ action: 'attach-assignment', ...input });
}

/** Age a capability so the application's real expiry rejection can be exercised. */
export function expireCapability(capabilityId: string): void {
  runFixture({ action: 'expire-capability', capabilityId });
}

/** Server-side assertion: current persisted Task status, version, and completion outcome. */
export function readTaskState(
  taskId: string,
): { status: string; version: number; outcome: unknown } | null {
  return runFixture({ action: 'read-task', taskId });
}

export interface CapabilityState {
  status: string;
  revokedAt: string | null;
  revocationReason: string | null;
  actionableAt: string | null;
  expiresAt: string;
  assignmentCapabilityStatus: string | null;
  assignmentDeliveryStatus: string | null;
}

/**
 * Server-side assertion: business-meaningful capability and assignment state.
 * Excludes `lastUsedAt`, which the schema defines as an access stamp rather than consumption.
 */
export function readCapabilityState(capabilityId: string): CapabilityState | null {
  return runFixture({ action: 'read-capability-state', capabilityId });
}

/** Server-side assertion: persisted notes for a Task. */
export function readTaskNotes(taskId: string): { body: string; attribution: unknown }[] {
  return runFixture({ action: 'read-notes', taskId });
}
