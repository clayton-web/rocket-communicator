import 'server-only';
import type { DbClient } from '@aicaa/db';
import type { Task } from '@aicaa/domain';
import type { DbRuntimeModule } from '@/lib/db/runtime-db';
import { getGmailAccessToken } from '@/lib/gmail/access-token';
import {
  getMessage as gmailGetMessage,
  getAttachment as gmailGetAttachment,
} from '@/lib/gmail/gmail-api-client';
import { buildAssignmentEmail } from '@/lib/gmail/outbound/assignment-email';
import { buildGmailForward, type GmailForwardSource } from '@/lib/gmail/outbound/gmail-forward';
import { transportFailure } from '@/lib/gmail/transport/errors';
import { createGmailTransport, type GmailTransport } from '@/lib/gmail/transport/gmail-transport';
import { evaluateGmailSendCapabilityFromStored } from '@/lib/gmail/transport/send-capability';
import { CIPHERTEXT_PURPOSE, decryptToken } from '@/lib/gmail/token-encryption';
import type {
  GmailAccessResolution,
  GmailAccessResolver,
  HandoffTransportPort,
  OutboundMessagePreparer,
  PrepareMessageInput,
  PrepareMessageResult,
} from './types';

/**
 * Production Gmail access resolver: connection + `gmail.send` capability + short-lived access token.
 *
 * This is a deterministic pre-persistence prerequisite. It resolves the Owner's connected account,
 * derives send capability from the persisted granted scopes (never a raw Google error), and — only
 * when send is available — exchanges the encrypted refresh token for an in-memory access token. The
 * refresh token is decrypted in memory and never logged; the access token is never persisted.
 */
export function createGmailAccessResolver(deps: {
  db: DbClient;
  runtime: Pick<
    DbRuntimeModule,
    'getCommunicationAccountByOrganization' | 'getGmailOAuthCredentialByAccountId'
  >;
  getAccessToken?: (input: { refreshToken: string }) => Promise<string>;
  decrypt?: (ciphertext: string) => string;
}): GmailAccessResolver {
  const getAccessToken = deps.getAccessToken ?? getGmailAccessToken;
  const decrypt =
    deps.decrypt ??
    ((ciphertext: string) => decryptToken(ciphertext, CIPHERTEXT_PURPOSE.GMAIL_REFRESH_TOKEN));

  return {
    async resolve(organizationId: string): Promise<GmailAccessResolution> {
      const account = await deps.runtime.getCommunicationAccountByOrganization(
        deps.db,
        organizationId,
      );
      if (!account || account.status !== 'connected') {
        return { state: 'not_connected' };
      }

      const credential = await deps.runtime.getGmailOAuthCredentialByAccountId(
        deps.db,
        organizationId,
        account.id,
      );
      const capability = evaluateGmailSendCapabilityFromStored({
        connected: true,
        grantedScopes: credential?.grantedScopes,
      });
      if (capability.state === 'not_connected') {
        return { state: 'not_connected' };
      }
      if (capability.state === 'send_scope_required') {
        return { state: 'send_scope_required' };
      }
      if (!credential?.encryptedRefreshToken) {
        return { state: 'not_connected' };
      }

      let accessToken: string;
      try {
        const refreshToken = decrypt(credential.encryptedRefreshToken);
        accessToken = await getAccessToken({ refreshToken });
      } catch {
        // Token refresh failed (needs reauth / transient). Conservatively treat as re-consent needed;
        // never leak the raw provider/OAuth error.
        return { state: 'send_scope_required' };
      }

      return {
        state: 'send_available',
        accessToken,
        from: { email: account.emailAddress },
        accountId: account.id,
      };
    },
  };
}

/** Derive privacy-safe assignment_email content from the Task summary (never source excerpts). */
function deriveAssignmentContent(task: Task): {
  taskTitle: string;
  taskSummary: string;
  ownerContext: string;
} {
  const points = task.summaryPoints ?? [];
  const pointText = (point: (typeof points)[number]): string =>
    ('value' in point && typeof point.value === 'string' ? point.value : point.label).trim();
  const taskTitle = points[0] ? pointText(points[0]) || 'New assignment' : 'New assignment';
  const taskSummary = points.map((point) => `- ${pointText(point)}`).join('\n') || taskTitle;
  return {
    taskTitle,
    taskSummary,
    ownerContext: 'You have been assigned a task via your assistant.',
  };
}

/**
 * Production outbound message preparer.
 *
 * assignment_email is composed entirely from the trusted Task summary + capability URL. gmail_forward
 * delegates to the A7.4 forward builder (which enforces the incomplete-forward policy) and requires a
 * trusted forward source resolved from persisted records — never an untrusted Gmail message id.
 *
 * Both `initial` and `retry` receive a server-built `capabilityUrl` from the store (freshly minted or
 * freshly rotated). This preparer never reconstructs or injects a prior URL; the `missing_capability_url`
 * guard is defense-in-depth only.
 */
export function createOutboundMessagePreparer(deps: {
  getMessage?: typeof gmailGetMessage;
  getAttachment?: typeof gmailGetAttachment;
  /** Resolve the trusted forward source (exact Gmail message + attachments) for an attempt. */
  forwardSource?: (input: {
    organizationId: string;
    accountId: string;
    attemptId: string;
    task: Task;
  }) => Promise<GmailForwardSource | undefined>;
}): OutboundMessagePreparer {
  const getMessage = deps.getMessage ?? gmailGetMessage;
  const getAttachment = deps.getAttachment ?? gmailGetAttachment;

  return {
    async prepare(input: PrepareMessageInput): Promise<PrepareMessageResult> {
      if (!input.capabilityUrl) {
        // Defensive only: the store always supplies a server-built URL for initial + winning retry.
        return {
          ok: false,
          failure: transportFailure('GMAIL_CONFIGURATION_ERROR', 'missing_capability_url'),
        };
      }

      const to = { email: input.capability.intendedRecipientEmail };

      if (input.deliveryPath === 'assignment_email') {
        const content = deriveAssignmentContent(input.task);
        return {
          ok: true,
          message: buildAssignmentEmail({
            from: input.access.from,
            to,
            ownerContext: content.ownerContext,
            taskTitle: content.taskTitle,
            taskSummary: content.taskSummary,
            recipientInstructions: input.ownerNote,
            capabilityUrl: input.capabilityUrl,
          }),
        };
      }

      // gmail_forward
      if (!deps.forwardSource) {
        return {
          ok: false,
          failure: transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', 'no_source_resolver'),
        };
      }
      const source = await deps.forwardSource({
        organizationId: input.attempt.organizationId,
        accountId: input.access.accountId,
        attemptId: input.attempt.id,
        task: input.task,
      });
      if (!source) {
        return {
          ok: false,
          failure: transportFailure('GMAIL_SOURCE_MESSAGE_UNAVAILABLE', 'source_unresolved'),
        };
      }

      return buildGmailForward(
        {
          from: input.access.from,
          to,
          ownerIntro: input.ownerNote?.trim() || 'Please see the forwarded message below.',
          capabilityUrl: input.capabilityUrl,
          source,
        },
        { accessToken: input.access.accessToken, getMessage, getAttachment },
      );
    },
  };
}

/** Production Gmail transport port wrapping the A7.4 transport (send outside any DB transaction). */
export function createHandoffTransportPort(
  deps: { transport?: GmailTransport } = {},
): HandoffTransportPort {
  const transport = deps.transport ?? createGmailTransport();
  return {
    send(input) {
      return transport.send({
        accessToken: input.accessToken,
        message: input.message,
        requestId: input.correlationId,
      });
    },
  };
}
