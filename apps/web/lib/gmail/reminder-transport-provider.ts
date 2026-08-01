import 'server-only';
import type { DbClient } from '@aicaa/db';
import type { DbRuntimeModule } from '@/lib/db/runtime-db';
import type {
  ReminderTransportProvider,
  ReminderTransportResolution,
} from '@/lib/reminders/transport';
import { createGmailAccessResolver } from '@/lib/handoff/runtime-adapters';
import type { GmailAccessResolver } from '@/lib/handoff/types';
import type { GmailRawSender } from './transport/gmail-transport';
import type { MimeBuildOptions } from './transport/mime';
import { createGmailReminderTransport } from './outbound/reminder-transport';

/**
 * A8.4b.1 once-per-invocation Gmail authorization for reminder delivery.
 *
 * This module exists because two guards point in opposite directions and both are correct.
 * `lib/reminders` may import no provider, so the transport cannot be built there. `lib/gmail/outbound`
 * may import no database layer, so authorization cannot be resolved there. Composition therefore
 * happens here, alongside `service.ts` and `poll-service.ts`, which join persistence to Gmail for the
 * same reason.
 */

export interface GmailReminderTransportProviderDeps {
  readonly db: DbClient;
  readonly runtime: Pick<
    DbRuntimeModule,
    'getCommunicationAccountByOrganization' | 'getGmailOAuthCredentialByAccountId'
  >;
  /** The single Owner organization reminders are delivered for. */
  readonly organizationId: string;
  /** Injectable for tests; production builds the A7 resolver. */
  readonly accessResolver?: GmailAccessResolver;
  readonly sendRaw?: GmailRawSender;
  readonly now?: () => Date;
  readonly mimeOptions?: MimeBuildOptions;
}

/**
 * Resolve Gmail authorization once, and hand back a transport bound to it (A8.4b.1).
 *
 * Reuses A7's `createGmailAccessResolver` verbatim: the Owner's connected account, the persisted
 * granted scopes, and a short-lived access token exchanged from the encrypted refresh token. Building
 * a second authorization path would mean a second place for the refresh-token decryption and scope
 * evaluation to disagree, and reminders have no requirement A7's resolver does not already satisfy.
 *
 * The returned provider is resolved exactly once per processing invocation, **before the first
 * claim**. That ordering is the point: resolving per occurrence would let an invocation claim ten
 * occurrences, deliver three, and only then discover the connection was never usable — having spent
 * three of a Recipient's fourteen local calendar days (D106) on messages that had no chance of being
 * sent. The transport handed back is bound to the one token this resolution produced, so no send can
 * silently refresh a second one.
 *
 * The two unavailable reasons are the resolver's own states, narrowed to privacy-safe strings. Both
 * mean the same thing to this invocation — nothing may be claimed — and are reported apart because
 * their remedies differ: connect an account, or grant the send scope.
 */
export function createGmailReminderTransportProvider(
  deps: GmailReminderTransportProviderDeps,
): ReminderTransportProvider {
  const accessResolver =
    deps.accessResolver ?? createGmailAccessResolver({ db: deps.db, runtime: deps.runtime });

  return {
    async resolve(): Promise<ReminderTransportResolution> {
      const access = await accessResolver.resolve(deps.organizationId);
      if (access.state === 'not_connected') {
        return { state: 'unavailable', reason: 'gmail_not_connected' };
      }
      if (access.state === 'send_scope_required') {
        return { state: 'unavailable', reason: 'gmail_send_scope_required' };
      }
      return {
        state: 'available',
        transport: createGmailReminderTransport({
          organizationId: deps.organizationId,
          accessToken: access.accessToken,
          from: access.from,
          sendRaw: deps.sendRaw,
          now: deps.now,
          mimeOptions: deps.mimeOptions,
        }),
      };
    },
  };
}
