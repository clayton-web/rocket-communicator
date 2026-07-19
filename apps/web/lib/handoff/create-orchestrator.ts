import 'server-only';
import type { DbClient } from '@aicaa/db';
import type { GmailForwardSource } from '@/lib/gmail/outbound/gmail-forward';
import type { Task } from '@aicaa/domain';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { createHandoffOrchestrator } from './orchestrator';
import {
  createGmailAccessResolver,
  createHandoffTransportPort,
  createOutboundMessagePreparer,
} from './runtime-adapters';
import { createRuntimeHandoffStore } from './runtime-store';
import type { HandoffLogger, HandoffOrchestrator } from './types';

/**
 * Production composition root for the A7.5 handoff orchestrator.
 *
 * Wires the traced DB runtime bridge (A7.3 primitives), the Gmail access resolver, the outbound
 * message preparer, and the A7.4 Gmail transport. This is the single entry point a future authorized
 * HTTP layer will call after it has authenticated the Owner and validated the request into a trusted
 * command. It never performs authentication, accepts untrusted payloads, or exposes an HTTP surface.
 */
export async function createRuntimeHandoffOrchestrator(deps: {
  db: DbClient;
  capabilityConfig: { pepper: string; ttlMs: number; appUrl: string };
  logger?: HandoffLogger;
  clock?: () => Date;
  /** Trusted forward-source resolver (persisted CommunicationEvent → exact Gmail message). */
  forwardSource?: (input: {
    organizationId: string;
    accountId: string;
    attemptId: string;
    task: Task;
  }) => Promise<GmailForwardSource | undefined>;
}): Promise<HandoffOrchestrator> {
  const runtime = await loadDbRuntime();

  const store = createRuntimeHandoffStore({
    db: deps.db,
    runtime,
    capabilityConfig: deps.capabilityConfig,
    clock: deps.clock,
  });
  const access = createGmailAccessResolver({ db: deps.db, runtime });
  const messages = createOutboundMessagePreparer({ forwardSource: deps.forwardSource });
  const transport = createHandoffTransportPort();

  return createHandoffOrchestrator({
    store,
    access,
    messages,
    transport,
    logger: deps.logger,
    clock: deps.clock,
  });
}
