/**
 * Shared harness for A7.5 handoff orchestration tests.
 *
 * Engine: in-process PGlite (embedded Postgres) via createTestDatabase() with the REAL A7.3
 * transaction primitives (createRuntimeHandoffStore backed by `@aicaa/db/runtime`). The Gmail
 * transport, access resolver, and message preparer are mocked — no real Gmail send occurs.
 */
import { vi } from 'vitest';
import {
  DEFAULT_CAPABILITY_TTL_MS,
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  HANDOFF_ACKNOWLEDGEMENT_V1,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  computeHandoffRequestFingerprint,
  identityHandoffFingerprintHasher,
  type Recipient,
  type Task,
} from '@aicaa/domain';
import * as aicaaDb from '@aicaa/db/runtime';
import {
  createRecipient,
  createTask,
  getCapabilityById,
  getHandoffAttemptById,
  getTaskById,
} from '@aicaa/db';
import type { TestDatabase } from '@aicaa/db/testing';
import { createHandoffOrchestrator } from '@/lib/handoff/orchestrator';
import { createRuntimeHandoffStore } from '@/lib/handoff/runtime-store';
import type { GmailSendResult } from '@/lib/gmail/transport/gmail-transport';
import type { OutboundMessage } from '@/lib/gmail/transport/outbound-types';
import type {
  GmailAccessResolution,
  GmailAccessResolver,
  HandoffLogRecord,
  HandoffLogger,
  HandoffOrchestratorDeps,
  HandoffStore,
  HandoffTransportPort,
  InitialHandoffCommand,
  OutboundMessagePreparer,
  PrepareMessageInput,
  PrepareMessageResult,
} from '@/lib/handoff/types';

export const ORG = 'org_a75';
export const OWNER_ID = 'owner_a75';
export const NOW = '2026-07-18T18:00:00.000Z';
export const CAPABILITY_CONFIG = {
  pepper: 'a75-capability-pepper-value-32chars!!',
  ttlMs: DEFAULT_CAPABILITY_TTL_MS,
  appUrl: 'http://localhost:3000',
};

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recipientFixture(id: string, email: string): Recipient {
  return {
    id: asRecipientId(id),
    displayName: 'A7.5 Recipient',
    email,
    active: true,
    relationshipLabel: 'assistant',
  };
}

export function unassignedTaskFixture(taskId: string): Task {
  return {
    id: asTaskId(taskId),
    organizationId: asOrganizationId(ORG),
    status: 'open',
    summaryPoints: [
      { id: 'p1', kind: 'next_action', label: 'Act', order: 0, value: 'Reply to the client' },
    ],
    notes: [],
    reminder: { paused: false },
    retention: {},
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function requestFingerprint(taskId: string, recipientId: string, salt = ''): string {
  return computeHandoffRequestFingerprint(
    {
      organizationId: ORG,
      taskId: asTaskId(taskId),
      recipientId: asRecipientId(recipientId),
      acknowledgement: `${HANDOFF_ACKNOWLEDGEMENT_V1}${salt}`,
    },
    identityHandoffFingerprintHasher,
  );
}

export interface SeededTask {
  taskId: string;
  recipientId: string;
  email: string;
}

export async function seedUnassignedTask(db: TestDatabase): Promise<SeededTask> {
  const taskId = nextId('task');
  const recipientId = nextId('rcp');
  const email = `${recipientId}@example.com`;
  await createRecipient(db.prisma, {
    organizationId: ORG,
    recipient: recipientFixture(recipientId, email),
  });
  await createTask(db.prisma, ORG, unassignedTaskFixture(taskId));
  return { taskId, recipientId, email };
}

export function initialCommand(
  seeded: SeededTask,
  over: Partial<InitialHandoffCommand> = {},
): InitialHandoffCommand {
  return {
    organizationId: ORG,
    ownerId: OWNER_ID,
    taskId: seeded.taskId,
    recipientId: seeded.recipientId,
    deliveryPath: 'assignment_email',
    idempotencyKey: over.idempotencyKey ?? nextId('idem'),
    requestFingerprint: requestFingerprint(seeded.taskId, seeded.recipientId),
    acknowledgement: HANDOFF_ACKNOWLEDGEMENT_V1,
    correlationId: 'corr_a75',
    ...over,
  };
}

export function realStore(db: TestDatabase): HandoffStore {
  return createRuntimeHandoffStore({
    db: db.prisma,
    runtime: aicaaDb,
    capabilityConfig: CAPABILITY_CONFIG,
  });
}

export function stubAccess(
  resolution: GmailAccessResolution = {
    state: 'send_available',
    accessToken: 'fake-access-token',
    from: { email: 'owner@corp.example' },
    accountId: 'acct_a75',
  },
): GmailAccessResolver & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(async () => resolution);
  return { resolve } as GmailAccessResolver & { resolve: ReturnType<typeof vi.fn> };
}

let providerSeq = 0;
type TransportSendInput = {
  accessToken: string;
  message: OutboundMessage;
  correlationId?: string;
};
export function stubTransport(
  impl?: (input: TransportSendInput) => Promise<GmailSendResult>,
): HandoffTransportPort & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async (input: TransportSendInput): Promise<GmailSendResult> => {
    if (impl) {
      return impl(input);
    }
    providerSeq += 1;
    return {
      ok: true,
      acceptance: {
        providerMessageId: `gmsg_${providerSeq}`,
        providerThreadId: `thr_${providerSeq}`,
        acceptedAt: NOW,
        deliveryPath: input.message.deliveryPath,
      },
    };
  });
  return { send } as HandoffTransportPort & { send: ReturnType<typeof vi.fn> };
}

export function stubMessages(
  impl?: (input: PrepareMessageInput) => Promise<PrepareMessageResult> | PrepareMessageResult,
): OutboundMessagePreparer & { prepare: ReturnType<typeof vi.fn> } {
  const prepare = vi.fn(async (input: PrepareMessageInput): Promise<PrepareMessageResult> => {
    if (impl) {
      return impl(input);
    }
    return {
      ok: true,
      message: {
        from: input.access.from,
        to: { email: input.capability.intendedRecipientEmail },
        subject: 'Assignment',
        textBody: 'body',
        deliveryPath: input.deliveryPath,
      },
    };
  });
  return { prepare } as OutboundMessagePreparer & { prepare: ReturnType<typeof vi.fn> };
}

export interface RecordingLogger extends HandoffLogger {
  records: HandoffLogRecord[];
}

export function recordingLogger(): RecordingLogger {
  const records: HandoffLogRecord[] = [];
  return {
    records,
    log(record) {
      records.push(record);
    },
  };
}

export function buildOrchestrator(db: TestDatabase, over: Partial<HandoffOrchestratorDeps> = {}) {
  const store = over.store ?? realStore(db);
  const access = over.access ?? stubAccess();
  const transport = over.transport ?? stubTransport();
  const messages = over.messages ?? stubMessages();
  const logger = over.logger ?? recordingLogger();
  const orchestrator = createHandoffOrchestrator({
    store,
    access,
    transport,
    messages,
    logger,
    clock: over.clock ?? (() => new Date(NOW)),
  });
  return { orchestrator, store, access, transport, messages, logger };
}

export async function readAttempt(db: TestDatabase, attemptId: string) {
  return getHandoffAttemptById(db.prisma, ORG, attemptId);
}

export async function readCapability(db: TestDatabase, capabilityId: string) {
  return getCapabilityById(db.prisma, ORG, capabilityId);
}

export async function readTask(db: TestDatabase, taskId: string) {
  return getTaskById(db.prisma, ORG, taskId);
}

export { aicaaDb, HANDOFF_ACKNOWLEDGEMENT_V1, DEFAULT_RECIPIENT_CAPABILITY_SCOPE };
