import type {
  CommunicationAccountId,
  CommunicationEventId,
  GmailSyncRunId,
  OrganizationId,
  TemporaryCommunicationExcerptId,
} from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import { validationError } from '../errors/domain-errors.js';

export type CommunicationProvider = 'gmail';

/** Persisted account lifecycle. API may also expose synthetic `not_connected` when no row exists. */
export type CommunicationAccountStatus =
  'pending' | 'connected' | 'needs_reauth' | 'resync_required' | 'disconnected' | 'error';

export type GmailHistoryState = 'unset' | 'valid' | 'resync_required';

export type GmailSyncTrigger = 'cron' | 'manual' | 'initial';

export type GmailSyncOutcome =
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'skipped_locked'
  | 'needs_reauth'
  | 'resync_required';

export type CommunicationEventStatus = 'active' | 'purged';

/** A5 default poll interval (D065). */
export const DEFAULT_GMAIL_POLL_INTERVAL_MINUTES = 5;

/** Temporary plain-text excerpt cap (D072). */
export const MAX_GMAIL_EXCERPT_BYTES = 8_192;

export const MAX_GMAIL_SUBJECT_LENGTH = 256;
export const MAX_GMAIL_SNIPPET_LENGTH = 512;

/** Inbox-only ingestion (D068). */
export const GMAIL_INBOX_LABEL_ID = 'INBOX';

/** Required OAuth scope for A5 (D070). */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export type {
  CommunicationAccountId,
  CommunicationEventId,
  GmailSyncRunId,
  TemporaryCommunicationExcerptId,
} from '../types/ids.js';
export {
  asCommunicationAccountId,
  asCommunicationEventId,
  asGmailSyncRunId,
  asTemporaryCommunicationExcerptId,
} from '../types/ids.js';

export interface CommunicationAccount {
  id: CommunicationAccountId;
  organizationId: OrganizationId;
  provider: CommunicationProvider;
  emailAddress: string;
  externalAccountId: string;
  status: CommunicationAccountStatus;
  historyId: string | null;
  historyState: GmailHistoryState;
  connectedAt: UtcInstant | null;
  disconnectedAt: UtcInstant | null;
  lastSyncAt: UtcInstant | null;
  lastSuccessAt: UtcInstant | null;
  lastErrorCode: string | null;
  lastErrorAt: UtcInstant | null;
  syncLockUntil: UtcInstant | null;
}

export interface AttachmentMetadataItem {
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface CommunicationEvent {
  id: CommunicationEventId;
  organizationId: OrganizationId;
  accountId: CommunicationAccountId;
  sourceType: 'gmail';
  providerMessageId: string;
  providerThreadId: string;
  dedupeKey: string;
  internalDate: UtcInstant;
  receivedAt: UtcInstant;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  snippet: string | null;
  labelIds: string[];
  hasAttachments: boolean;
  attachmentMetadata: AttachmentMetadataItem[];
  status: CommunicationEventStatus;
  ingestRunId: GmailSyncRunId | null;
  purgeAt: UtcInstant | null;
}

export interface TemporaryCommunicationExcerpt {
  id: TemporaryCommunicationExcerptId;
  organizationId: OrganizationId;
  communicationEventId: CommunicationEventId;
  content: string;
  byteLength: number;
  purgeAt: UtcInstant;
  purgedAt: UtcInstant | null;
}

export interface GmailSyncRun {
  id: GmailSyncRunId;
  organizationId: OrganizationId;
  accountId: CommunicationAccountId;
  trigger: GmailSyncTrigger;
  outcome: GmailSyncOutcome;
  startedAt: UtcInstant;
  finishedAt: UtcInstant | null;
  historyIdBefore: string | null;
  historyIdAfter: string | null;
  messagesExamined: number;
  eventsCreated: number;
  eventsUpdated: number;
  messagesSkipped: number;
  retryable: boolean;
  errorCode: string | null;
  requestId: string | null;
}

/** Workspace-domain mailbox gate (D069). */
export function assertGmailMailboxMatchesWorkspaceDomain(
  emailAddress: string,
  ownerWorkspaceDomain: string,
): void {
  const email = emailAddress.trim().toLowerCase();
  const domain = ownerWorkspaceDomain.trim().toLowerCase().replace(/^@/, '');
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) {
    throw validationError('Gmail mailbox email is invalid.');
  }
  const emailDomain = email.slice(at + 1);
  if (emailDomain !== domain) {
    throw validationError('Gmail mailbox domain must match OWNER_WORKSPACE_DOMAIN.');
  }
}

/** Inbox-only eligibility (D068). */
export function isGmailInboxEligible(labelIds: readonly string[]): boolean {
  return labelIds.includes(GMAIL_INBOX_LABEL_ID);
}

/** UTF-8 byte length without Node/DOM globals (domain stays portable). */
export function measureExcerptByteLength(content: string): number {
  let bytes = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function assertExcerptWithinCap(content: string): void {
  const bytes = measureExcerptByteLength(content);
  if (bytes > MAX_GMAIL_EXCERPT_BYTES) {
    throw validationError(`Gmail excerpt exceeds ${MAX_GMAIL_EXCERPT_BYTES} byte cap.`);
  }
}

export function truncateGmailSubject(subject: string | null | undefined): string | null {
  if (subject == null) {
    return null;
  }
  const trimmed = subject.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length <= MAX_GMAIL_SUBJECT_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_GMAIL_SUBJECT_LENGTH);
}

export function truncateGmailSnippet(snippet: string | null | undefined): string | null {
  if (snippet == null) {
    return null;
  }
  const trimmed = snippet.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length <= MAX_GMAIL_SNIPPET_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_GMAIL_SNIPPET_LENGTH);
}

/** Stable org-scoped dedupe key for a Gmail provider message id. */
export function buildGmailDedupeKey(providerMessageId: string): string {
  return `gmail:${providerMessageId}`;
}

/** Parsed Gmail message fixture for persistence (no API client). */
export interface ParsedGmailMessageFixture {
  eventId: CommunicationEventId;
  providerMessageId: string;
  providerThreadId: string;
  internalDate: UtcInstant;
  receivedAt?: UtcInstant;
  fromAddress: string;
  toAddresses: string[];
  subject?: string | null;
  snippet?: string | null;
  labelIds: string[];
  hasAttachments: boolean;
  attachmentMetadata?: AttachmentMetadataItem[];
  excerptId?: TemporaryCommunicationExcerptId;
  excerptContent?: string | null;
  excerptPurgeAt?: UtcInstant;
}
