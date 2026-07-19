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
import { createTaskGmailForwardSource } from './forward-source';
import { createRuntimeHandoffStore } from './runtime-store';
import type { HandoffLogger, HandoffOrchestrator } from './types';

/**
 * Production composition root for the A7.5/A7.7 handoff orchestrator.
 *
 * Wires the traced DB runtime bridge (A7.3 primitives), the Gmail access resolver, the outbound
 * message preparer (with the trusted Task forward-source resolver), and the A7.4 Gmail transport.
 * The authorized HTTP layer calls this after authentication + validation into a trusted command.
 * It never performs authentication or accepts untrusted payloads.
 */
export async function createRuntimeHandoffOrchestrator(deps: {
  db: DbClient;
  capabilityConfig: { pepper: string; ttlMs: number; appUrl: string };
  logger?: HandoffLogger;
  clock?: () => Date;
  /**
   * Trusted forward-source resolver. Defaults to {@link createTaskGmailForwardSource} which derives
   * the Gmail message id solely from the persisted Task source reference (never from the request).
   */
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
  const messages = createOutboundMessagePreparer({
    forwardSource: deps.forwardSource ?? createTaskGmailForwardSource(),
  });
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
