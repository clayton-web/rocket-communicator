import 'server-only';
import { GMAIL_INBOX_LABEL_ID } from '@aicaa/domain';
import { classifyGmailHttpError, GmailSyncError } from './sync-errors';

/**
 * Direct Gmail REST client (A5.4). Uses fetch only — no `googleapis` dependency.
 * Access tokens are caller-supplied and never logged. Message bodies are returned to the
 * sync engine for minimization; this module does not persist anything.
 *
 * `users.messages.get` uses `format=full` in a single request so headers, labels, snippet,
 * and MIME structure (for text/plain excerpt + attachment metadata) arrive together without
 * a second round-trip. Attachment bytes are never fetched via attachments.get.
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailProfile {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  /** Gmail history ids are opaque strings; never coerce to number. */
  historyId: string;
}

export interface GmailHistoryMessageRef {
  id?: string;
  threadId?: string;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id?: string;
  messages?: GmailHistoryMessageRef[];
  messagesAdded?: Array<{ message?: GmailHistoryMessageRef }>;
  labelsAdded?: Array<{ message?: GmailHistoryMessageRef; labelIds?: string[] }>;
  labelsRemoved?: Array<{ message?: GmailHistoryMessageRef; labelIds?: string[] }>;
}

export interface GmailHistoryListResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  /** Newest history id covered by this page; keep as string. */
  historyId?: string;
}

export interface GmailMessageHeader {
  name?: string;
  value?: string;
}

export interface GmailMessagePartBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

async function gmailFetch<T>(
  accessToken: string,
  pathWithQuery: string,
  options?: { treat404As?: GmailSyncError['code'] },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GMAIL_API_BASE}${pathWithQuery}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch {
    throw new GmailSyncError('network_failure');
  }

  if (!response.ok) {
    // Read body only for status classification — never surface it.
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }
    if (response.status === 404 && options?.treat404As) {
      throw new GmailSyncError(options.treat404As);
    }
    throw classifyGmailHttpError(response.status, bodyText);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new GmailSyncError('malformed_message', 'Gmail response was not valid JSON.');
  }
}

/** users.getProfile — used for initial no-backfill cursor seeding. */
export async function getProfile(accessToken: string): Promise<GmailProfile> {
  const raw = await gmailFetch<{
    emailAddress?: string;
    messagesTotal?: number;
    threadsTotal?: number;
    historyId?: string | number;
  }>(accessToken, '/profile');

  if (raw.historyId == null || raw.historyId === '') {
    throw new GmailSyncError('malformed_message', 'Gmail profile is missing historyId.');
  }

  return {
    emailAddress: raw.emailAddress,
    messagesTotal: raw.messagesTotal,
    threadsTotal: raw.threadsTotal,
    historyId: String(raw.historyId),
  };
}

/**
 * users.history.list restricted to messageAdded + labelAdded (Inbox eligibility changes).
 * 404 → invalid_history (expired/unknown startHistoryId).
 */
export async function listHistory(input: {
  accessToken: string;
  startHistoryId: string;
  pageToken?: string;
}): Promise<GmailHistoryListResponse> {
  const params = new URLSearchParams();
  params.set('startHistoryId', input.startHistoryId);
  params.append('historyTypes', 'messageAdded');
  params.append('historyTypes', 'labelAdded');
  params.append('historyTypes', 'labelRemoved');
  if (input.pageToken) {
    params.set('pageToken', input.pageToken);
  }

  const raw = await gmailFetch<{
    history?: GmailHistoryRecord[];
    nextPageToken?: string;
    historyId?: string | number;
  }>(input.accessToken, `/history?${params.toString()}`, { treat404As: 'invalid_history' });

  return {
    history: raw.history,
    nextPageToken: raw.nextPageToken,
    historyId: raw.historyId == null ? undefined : String(raw.historyId),
  };
}

/**
 * users.messages.get with format=full and a narrow fields projection.
 * One request yields metadata + body parts for excerpt extraction without attachments.get.
 * Raw response is memory-only; the sync engine normalizes immediately and discards it.
 */
export async function getMessage(input: {
  accessToken: string;
  messageId: string;
}): Promise<GmailMessage> {
  const params = new URLSearchParams({
    format: 'full',
    // Narrow projection: identity, labels, snippet, dates, and MIME tree for text + attachment metadata.
    // Never request attachment bytes via users.attachments.get.
    fields:
      'id,threadId,labelIds,snippet,internalDate,payload(mimeType,filename,headers(name,value),body(size,data,attachmentId),parts(mimeType,filename,headers(name,value),body(size,data,attachmentId),parts(mimeType,filename,headers(name,value),body(size,data,attachmentId),parts(mimeType,filename,body(size,data,attachmentId)))))',
  });
  const raw = await gmailFetch<GmailMessage>(
    input.accessToken,
    `/messages/${encodeURIComponent(input.messageId)}?${params.toString()}`,
    { treat404As: 'malformed_message' },
  );
  if (!raw.id) {
    throw new GmailSyncError('malformed_message', 'Gmail message is missing id.');
  }
  return raw;
}

/**
 * Collect unique message ids from a history page.
 * Includes messagesAdded and label changes that can add/remove Inbox eligibility.
 */
export function extractMessageIdsFromHistory(
  history: readonly GmailHistoryRecord[] | undefined,
): string[] {
  const ids = new Set<string>();
  if (!history) {
    return [];
  }

  for (const record of history) {
    for (const added of record.messagesAdded ?? []) {
      const id = added.message?.id;
      if (id) {
        ids.add(id);
      }
    }
    for (const labeled of record.labelsAdded ?? []) {
      const labelIds = labeled.labelIds ?? [];
      if (!labelIds.includes(GMAIL_INBOX_LABEL_ID)) {
        continue;
      }
      const id = labeled.message?.id;
      if (id) {
        ids.add(id);
      }
    }
    for (const labeled of record.labelsRemoved ?? []) {
      const labelIds = labeled.labelIds ?? [];
      if (!labelIds.includes(GMAIL_INBOX_LABEL_ID)) {
        continue;
      }
      const id = labeled.message?.id;
      if (id) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

export type GmailApiClient = {
  getProfile: typeof getProfile;
  listHistory: typeof listHistory;
  getMessage: typeof getMessage;
};

export const defaultGmailApiClient: GmailApiClient = {
  getProfile,
  listHistory,
  getMessage,
};
