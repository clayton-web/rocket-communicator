import type {
  ActionAttribution,
  CapabilityStatus,
  CapabilityScope,
  CommunicationAccount,
  CommunicationEvent,
  GmailSyncRun,
  ReminderMetadata,
  RetentionMetadata,
  SourceReference,
  Task,
  TaskAssignment,
  TaskCapability,
  TaskNote,
  TaskOutcome,
  TaskSuggestion,
  TaskSummaryPoint,
  TemporaryCommunicationExcerpt,
  Recipient,
} from '@aicaa/domain';
import {
  asAssignmentId,
  asCapabilityId,
  asCommunicationAccountId,
  asCommunicationEventId,
  asGmailSyncRunId,
  asOrganizationId,
  asOwnerId,
  asRecipientId,
  asTaskId,
  asTaskSuggestionId,
  asTemporaryCommunicationExcerptId,
  toUtcInstant,
} from '../../../domain/dist/index.js';
import type {
  AuditEvent as PrismaAuditEvent,
  CommunicationAccount as PrismaCommunicationAccount,
  CommunicationEvent as PrismaCommunicationEvent,
  GmailSyncRun as PrismaGmailSyncRun,
  Recipient as PrismaRecipient,
  Task as PrismaTask,
  TaskAssignment as PrismaAssignment,
  TaskCapability as PrismaCapability,
  TaskNote as PrismaNote,
  TaskSuggestion as PrismaSuggestion,
  TemporaryCommunicationExcerpt as PrismaTemporaryCommunicationExcerpt,
} from '../generated/client/index.js';

export function toIso(value: Date): string {
  return toUtcInstant(value);
}

export function fromIso(value: string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  return new Date(value);
}

export function mapRecipient(row: PrismaRecipient): Recipient {
  return {
    id: asRecipientId(row.id),
    displayName: row.displayName,
    email: row.email,
    relationshipLabel: row.relationshipLabel ?? undefined,
    active: row.active,
    reminderPreferences:
      (row.reminderPreferences as unknown as Recipient['reminderPreferences']) ?? undefined,
    assignmentCategories:
      (row.assignmentCategories as unknown as Recipient['assignmentCategories']) ?? undefined,
  };
}

export function mapAssignment(row: PrismaAssignment): TaskAssignment {
  return {
    id: asAssignmentId(row.id),
    recipientId: asRecipientId(row.recipientId),
    intendedRecipientEmail: row.intendedRecipientEmail,
    assignedAt: toIso(row.assignedAt),
    assignedByOwnerId: asOwnerId(row.assignedByOwnerId),
    assignmentApprovedAt: row.assignmentApprovedAt ? toIso(row.assignmentApprovedAt) : undefined,
    allowedCapabilityActions: row.allowedCapabilityActions as unknown as CapabilityScope,
    capabilityStatus: (row.capabilityStatus as CapabilityStatus | null) ?? undefined,
    deliveryStatus: row.deliveryStatus ?? undefined,
    activeCapabilityId: row.activeCapabilityId ?? undefined,
  };
}

export function mapNote(row: PrismaNote): TaskNote {
  return {
    id: row.id,
    body: row.body,
    createdAt: toIso(row.createdAt),
    attribution: row.attribution as unknown as ActionAttribution,
  };
}

export function mapTask(
  row: PrismaTask,
  assignment: PrismaAssignment | null,
  notes: PrismaNote[],
): Task {
  const prior = row.priorActionableStatus;
  return {
    id: asTaskId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    status: row.status,
    priorActionableStatus:
      prior === 'open' || prior === 'in_progress' ? prior : prior == null ? null : undefined,
    summaryPoints: row.summaryPoints as unknown as TaskSummaryPoint[],
    assignment: assignment && assignment.clearedAt == null ? mapAssignment(assignment) : undefined,
    sourceReference: (row.sourceReference as unknown as SourceReference | null) ?? undefined,
    dueAt: row.dueAt ? toIso(row.dueAt) : null,
    waitingUntil: row.waitingUntil ? toIso(row.waitingUntil) : null,
    priority: row.priority ?? undefined,
    outcome: (row.outcome as unknown as TaskOutcome | null) ?? undefined,
    notes: notes.map(mapNote),
    reminder: row.reminder as unknown as ReminderMetadata,
    retention: row.retention as unknown as RetentionMetadata,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapSuggestion(row: PrismaSuggestion): TaskSuggestion {
  return {
    id: asTaskSuggestionId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    status: row.status,
    summaryPoints: row.summaryPoints as unknown as TaskSummaryPoint[],
    sourceReference: (row.sourceReference as unknown as SourceReference | null) ?? undefined,
    proposedRecipientId: row.proposedRecipientId ?? undefined,
    proposedDueAt: row.proposedDueAt ? toIso(row.proposedDueAt) : undefined,
    proposedPriority: row.proposedPriority ?? undefined,
    voiceOriginated: row.voiceOriginated,
    mergedIntoTaskId: row.mergedIntoTaskId ? asTaskId(row.mergedIntoTaskId) : null,
    retention: row.retention as unknown as RetentionMetadata,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapCapability(row: PrismaCapability): TaskCapability & { tokenHash: string } {
  return {
    id: asCapabilityId(row.id),
    taskId: asTaskId(row.taskId),
    assignmentId: asAssignmentId(row.assignmentId),
    recipientId: row.recipientId ? asRecipientId(row.recipientId) : undefined,
    intendedRecipientEmail: row.intendedRecipientEmail,
    scope: row.scope as unknown as CapabilityScope,
    status: row.status as CapabilityStatus,
    issuedAt: toIso(row.issuedAt),
    expiresAt: toIso(row.expiresAt),
    revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
    lastUsedAt: row.lastUsedAt ? toIso(row.lastUsedAt) : null,
    tokenHash: row.tokenHash,
  };
}

export type AuditEventRecord = {
  id: string;
  organizationId: string;
  actorKind: 'owner' | 'capability' | 'system';
  ownerId?: string;
  capabilityId?: string;
  systemId?: string;
  assignmentId?: string;
  taskId?: string;
  suggestionId?: string;
  communicationAccountId?: string;
  communicationEventId?: string;
  gmailSyncRunId?: string;
  intendedRecipientEmail?: string;
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  resourceVersion?: number;
  taskStatus?: string;
  note?: string;
  requestId?: string;
  correlationId?: string | null;
  attributionLabel?: string;
  recordedAt: string;
};

export function mapAuditEvent(row: PrismaAuditEvent): AuditEventRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actorKind: row.actorKind,
    ownerId: row.ownerId ?? undefined,
    capabilityId: row.capabilityId ?? undefined,
    systemId: row.systemId ?? undefined,
    assignmentId: row.assignmentId ?? undefined,
    taskId: row.taskId ?? undefined,
    suggestionId: row.suggestionId ?? undefined,
    communicationAccountId: row.communicationAccountId ?? undefined,
    communicationEventId: row.communicationEventId ?? undefined,
    gmailSyncRunId: row.gmailSyncRunId ?? undefined,
    intendedRecipientEmail: row.intendedRecipientEmail ?? undefined,
    action: row.action,
    outcome: row.outcome,
    resourceVersion: row.resourceVersion ?? undefined,
    taskStatus: row.taskStatus ?? undefined,
    note: row.note ?? undefined,
    requestId: row.requestId ?? undefined,
    correlationId: row.correlationId,
    attributionLabel: row.attributionLabel ?? undefined,
    recordedAt: toIso(row.recordedAt),
  };
}

export function mapCommunicationAccount(row: PrismaCommunicationAccount): CommunicationAccount {
  return {
    id: asCommunicationAccountId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    provider: row.provider,
    emailAddress: row.emailAddress,
    externalAccountId: row.externalAccountId,
    status: row.status,
    historyId: row.historyId,
    historyState: row.historyState,
    connectedAt: row.connectedAt ? toIso(row.connectedAt) : null,
    disconnectedAt: row.disconnectedAt ? toIso(row.disconnectedAt) : null,
    lastSyncAt: row.lastSyncAt ? toIso(row.lastSyncAt) : null,
    lastSuccessAt: row.lastSuccessAt ? toIso(row.lastSuccessAt) : null,
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt ? toIso(row.lastErrorAt) : null,
    syncLockUntil: row.syncLockUntil ? toIso(row.syncLockUntil) : null,
  };
}

export type GmailOAuthCredentialRecord = {
  id: string;
  accountId: string;
  organizationId: string;
  encryptedRefreshToken: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: string | null;
  grantedScopes: string;
  tokenType: string | null;
  encryptionKeyVersion: string;
};

export function mapCommunicationEvent(row: PrismaCommunicationEvent): CommunicationEvent {
  return {
    id: asCommunicationEventId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    accountId: asCommunicationAccountId(row.accountId),
    sourceType: 'gmail',
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    dedupeKey: row.dedupeKey,
    internalDate: toIso(row.internalDate),
    receivedAt: toIso(row.receivedAt),
    fromAddress: row.fromAddress,
    toAddresses: row.toAddresses as unknown as string[],
    subject: row.subject,
    snippet: row.snippet,
    labelIds: row.labelIds as unknown as string[],
    hasAttachments: row.hasAttachments,
    attachmentMetadata:
      row.attachmentMetadata as unknown as CommunicationEvent['attachmentMetadata'],
    status: row.status,
    ingestRunId: row.ingestRunId ? asGmailSyncRunId(row.ingestRunId) : null,
    purgeAt: row.purgeAt ? toIso(row.purgeAt) : null,
  };
}

export function mapTemporaryCommunicationExcerpt(
  row: PrismaTemporaryCommunicationExcerpt,
): TemporaryCommunicationExcerpt {
  return {
    id: asTemporaryCommunicationExcerptId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    communicationEventId: asCommunicationEventId(row.communicationEventId),
    content: row.content,
    byteLength: row.byteLength,
    purgeAt: toIso(row.purgeAt),
    purgedAt: row.purgedAt ? toIso(row.purgedAt) : null,
  };
}

export function mapGmailSyncRun(row: PrismaGmailSyncRun): GmailSyncRun {
  return {
    id: asGmailSyncRunId(row.id),
    organizationId: asOrganizationId(row.organizationId),
    accountId: asCommunicationAccountId(row.accountId),
    trigger: row.trigger,
    outcome: row.outcome,
    startedAt: toIso(row.startedAt),
    finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
    historyIdBefore: row.historyIdBefore,
    historyIdAfter: row.historyIdAfter,
    messagesExamined: row.messagesExamined,
    eventsCreated: row.eventsCreated,
    eventsUpdated: row.eventsUpdated,
    messagesSkipped: row.messagesSkipped,
    retryable: row.retryable,
    errorCode: row.errorCode,
    requestId: row.requestId,
  };
}
