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

/**
 * Durable suggestion-processing outcome on CommunicationEvent (D081).
 * A5 ingestion leaves events as `unprocessed`; A6 process workers advance the status.
 */
export type SuggestionProcessingStatus =
  | 'unprocessed'
  | 'skipped_irrelevant'
  | 'suggestion_created'
  | 'failed_retryable'
  | 'failed_permanent';

/** Default max claim attempts before a retryable failure becomes ineligible (A6.1). */
export const DEFAULT_SUGGESTION_PROCESSING_MAX_ATTEMPTS = 5;

/** A5 default poll interval (D065). */
export const DEFAULT_GMAIL_POLL_INTERVAL_MINUTES = 5;

/** Temporary plain-text excerpt cap (D072). */
export const MAX_GMAIL_EXCERPT_BYTES = 8_192;

/** Subject character cap (A5.4). */
export const MAX_GMAIL_SUBJECT_LENGTH = 256;

/**
 * Snippet UTF-8 byte cap (A5.4). Kept as MAX_GMAIL_SNIPPET_LENGTH for stable export name;
 * enforcement uses UTF-8 bytes, not JavaScript string length.
 */
export const MAX_GMAIL_SNIPPET_LENGTH = 512;

/** Cap recipient arrays persisted on CommunicationEvent. */
export const MAX_GMAIL_TO_ADDRESSES = 50;

/** Cap attachment metadata entries per event (D071). */
export const MAX_GMAIL_ATTACHMENT_METADATA_ITEMS = 20;

/** Cap attachment filenames (bytes are never stored). */
export const MAX_GMAIL_ATTACHMENT_FILENAME_LENGTH = 255;

/**
 * Ingest-time excerpt retention window in days (D078).
 * `purgeAt = syncedAt + DEFAULT_GMAIL_EXCERPT_RETENTION_DAYS`.
 * Later milestones may shorten this when D020 complete/dismiss timers apply.
 */
export const DEFAULT_GMAIL_EXCERPT_RETENTION_DAYS = 7;

/** Soft caps for one Owner manual sync request (A5.4). */
export const MAX_GMAIL_HISTORY_PAGES_PER_RUN = 5;
export const MAX_GMAIL_MESSAGES_PER_RUN = 50;

/** Inbox-only ingestion (D068). */
export const GMAIL_INBOX_LABEL_ID = 'INBOX';

/** Labels that permanently exclude a message from A5 Inbox ingestion (D068). */
export const GMAIL_EXCLUDED_LABEL_IDS = ['DRAFT', 'SPAM', 'TRASH'] as const;

/** Required OAuth read scope for A5 (D070); retained for A7 forward source access (D093). */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** A7 send scope required for Owner outbound handoff mail (D093, D094). */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

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

/** Durable CommunicationEvent source discriminator. Gmail remains the A5/A6 source. */
export type CommunicationEventSourceType = 'gmail' | 'google_messages';

export interface CommunicationEvent {
  id: CommunicationEventId;
  organizationId: OrganizationId;
  /**
   * Required for Gmail. Null for Google Messages — D181 forbids a synthetic
   * CommunicationAccount for that source.
   */
  accountId: CommunicationAccountId | null;
  sourceType: CommunicationEventSourceType;
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
  /** D081 suggestion-processing fields (A6). Defaults to unprocessed at A5 ingest. */
  suggestionProcessingStatus: SuggestionProcessingStatus;
  suggestionProcessedAt: UtcInstant | null;
  suggestionProcessingAttempts: number;
  suggestionLastErrorCode: string | null;
  suggestionClaimUntil: UtcInstant | null;
  suggestionClaimOwner: string | null;
  suggestionPolicyVersion: string | null;
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

/**
 * The header Rocket stamps on mail it generates itself (D136).
 *
 * Owner Event Notifications are addressed from the connected mailbox **to that same mailbox**, so
 * Gmail files one message under both `SENT` and `INBOX`. D068 ingestion admits `INBOX` unless the
 * message is `DRAFT`, `SPAM`, or `TRASH`, which means every Owner notification would otherwise be
 * ingested, excerpted, and offered to A6 as a Task Suggestion derived from Rocket's own mail.
 *
 * The marker is the narrowest fix available. The alternatives D136 considered and rejected —
 * excluding all `SENT` mail, or all mail whose sender equals the connected address — would silently
 * narrow D068 for genuine Owner mail: a Task the Owner mails to themselves, or a thread they replied
 * into, is exactly the material A6 exists to notice.
 */
export const ROCKET_GENERATED_HEADER_NAME = 'X-Rocket-Generated';

/**
 * The only value that header may carry today.
 *
 * A closed union rather than a free string. A future Rocket-generated message class must be added
 * here deliberately, which is also what stops the header from becoming a general-purpose channel for
 * whatever a caller wants to say about a message.
 */
export const ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION = 'owner-event-notification';
export type RocketGeneratedMarker = typeof ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION;

/**
 * Decide whether observed `X-Rocket-Generated` header values earn the D136 ingestion exclusion.
 *
 * Takes **every** value seen for that header name rather than the first, because "how many are
 * there" is part of the answer.
 *
 * ## The exclusion is a privilege, and ambiguity denies it
 *
 * Skipping ingestion is the power to make one of the Owner's messages invisible to A6, so it is
 * granted only to input that looks exactly like something Rocket's own MIME builder emitted:
 * precisely one header, carrying precisely the ratified token. Two markers, an empty value, or a
 * token that merely resembles the ratified one all fail closed — the message stays eligible and is
 * governed by the ordinary D068 label rules. Rocket's builder cannot produce any of those shapes,
 * so nothing legitimate is refused, and a forged near-miss buys its sender nothing.
 *
 * ## What is normalized, and why only that
 *
 * Surrounding whitespace is stripped, because unfolding a header legitimately leaves it, and the
 * comparison is case-insensitive, because a fixed emitted token differing only in case is the same
 * token and failing to recognize our own message is the D136 failure this exists to prevent.
 * Nothing else is normalized: no prefix match, no substring search, no punctuation folding. A body
 * quoting the marker is unreachable from here by construction, since only header values are ever
 * passed in.
 */
export function isRocketGeneratedOwnerNotification(headerValues: readonly string[]): boolean {
  if (headerValues.length !== 1) {
    return false;
  }
  return headerValues[0].trim().toLowerCase() === ROCKET_GENERATED_OWNER_EVENT_NOTIFICATION;
}

/** Inbox-only eligibility (D068): requires INBOX; excludes Draft/Spam/Trash; Sent-only excluded. */
export function isGmailInboxEligible(labelIds: readonly string[]): boolean {
  if (!labelIds.includes(GMAIL_INBOX_LABEL_ID)) {
    return false;
  }
  for (const excluded of GMAIL_EXCLUDED_LABEL_IDS) {
    if (labelIds.includes(excluded)) {
      return false;
    }
  }
  return true;
}

/**
 * Ingest-time excerpt purgeAt (D078): syncedAt + 7 days.
 * D020 may replace this deadline once a suggestion/task owns the excerpt.
 */
export function computeDefaultGmailExcerptPurgeAt(
  syncedAt: string,
  retentionDays: number = DEFAULT_GMAIL_EXCERPT_RETENTION_DAYS,
): string {
  const base = Date.parse(syncedAt);
  if (!Number.isFinite(base)) {
    throw validationError('syncedAt must be a valid UTC instant for excerpt purgeAt.');
  }
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw validationError('Excerpt retention days must be a positive integer.');
  }
  return new Date(base + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/** Cap a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  // Portable UTF-8 truncation without Node Buffer (domain package constraint).
  let bytes = 0;
  let endIndex = 0;
  while (endIndex < text.length) {
    const code = text.charCodeAt(endIndex);
    let charBytes = 1;
    let advance = 1;
    if (code <= 0x7f) {
      charBytes = 1;
    } else if (code <= 0x7ff) {
      charBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      charBytes = 4;
      advance = 2;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Orphan surrogate — treat as 3-byte replacement unit.
      charBytes = 3;
    } else {
      charBytes = 3;
    }
    if (bytes + charBytes > maxBytes) {
      break;
    }
    bytes += charBytes;
    endIndex += advance;
  }
  return text.slice(0, endIndex);
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
  const capped = truncateUtf8Bytes(trimmed, MAX_GMAIL_SNIPPET_LENGTH);
  return capped.length > 0 ? capped : null;
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
