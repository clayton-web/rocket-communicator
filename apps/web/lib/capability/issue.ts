import {
  DEFAULT_RECIPIENT_CAPABILITY_SCOPE,
  asCapabilityId,
  issueTaskCapability,
  ownerActor,
  type CapabilityAction,
  type CapabilityId,
  type CapabilityScope,
  type CapabilityStatus,
  type OwnerActor,
  type Task,
  type TaskAssignment,
  type TaskCapability,
  type UtcInstant,
} from '@aicaa/domain';
import type {
  AuditEventRecord,
  DbClient,
  DbTransaction,
} from '@aicaa/db';
import { loadDbRuntime } from '@/lib/db/runtime-db';
import { isCapabilityTokenError, readPersistenceErrorCode } from '@/lib/errors/safe-error-shapes';
import {
  assertValidCapabilityPepper,
  assertValidCapabilityTtlMs,
  type CapabilityTokenConfig,
} from './config';
import { CapabilityTokenError, capabilityTokenError } from './errors';
import { assertNoRawCapabilityToken } from './redact';
import { generateCapabilityToken, hashCapabilityToken } from './token';
import { buildCapabilityUrl } from './urls';

export interface IssueCapabilityCommand {
  db: DbClient;
  owner: OwnerActor;
  taskId: string;
  /**
   * Required injected TTL (D055). Prefer `config.ttlMs` from server configuration.
   * Domain still receives an explicit value — never silently invents one.
   */
  ttlMs: number;
  pepper: string;
  appUrl: string;
  now: UtcInstant;
  /**
   * When provided (Owner HTTP If-Match), must equal the current task version.
   * Mismatch → PRECONDITION_FAILED. Used as the optimistic write precondition.
   */
  expectedVersion?: number;
  capabilityId?: CapabilityId;
  /**
   * Optional subset of the assignment's allowed recipient actions (OpenAPI IssueTaskCapabilityRequest).
   * Never expands beyond the assignment. When omitted, the assignment's allowed actions are used.
   */
  scope?: CapabilityScope;
  requestId?: string;
  correlationId?: string | null;
  auditId?: string;
  /** Injectable CSPRNG for tests. */
  random?: () => Buffer;
}

/** Safe one-time issuance payload — never includes tokenHash, pepper, or Prisma persistence fields. */
export interface SafeIssuedCapability {
  id: string;
  taskId: string;
  assignmentId: string;
  permittedActions: CapabilityScope;
  status: CapabilityStatus;
  issuedAt: UtcInstant;
  expiresAt: UtcInstant;
  intendedRecipientEmail: string;
}

export interface IssuedCapabilityResult {
  capability: SafeIssuedCapability;
  /** Reloaded task snapshot after issuance (assignment actions unchanged). */
  task: Task;
  /** Returned exactly once; never persisted or logged. */
  rawToken: string;
  capabilityUrl: string;
  audit: AuditEventRecord;
  /** Prior active capability revoked during replacement, if any. */
  replacedCapabilityId?: string;
}

export type ReplaceCapabilityCommand = IssueCapabilityCommand;

/**
 * Resolve capability scope from the active assignment.
 * Optional overrides must be a subset of assignment-allowed actions — never broader.
 */
export function resolveCapabilityScopeFromAssignment(
  assignment: TaskAssignment,
  requested?: CapabilityScope,
): CapabilityScope {
  const allowed: CapabilityScope =
    assignment.allowedCapabilityActions.length > 0
      ? assignment.allowedCapabilityActions
      : [...DEFAULT_RECIPIENT_CAPABILITY_SCOPE];

  if (!allowed.includes('view_assigned_task')) {
    throw capabilityTokenError(
      'ISSUANCE_PRECONDITION',
      'Assignment must allow view_assigned_task before issuing a capability link.',
      { assignmentId: assignment.id },
    );
  }

  if (!requested || requested.length === 0) {
    return [...allowed];
  }

  const allowedSet = new Set<CapabilityAction>(allowed);
  for (const action of requested) {
    if (!allowedSet.has(action)) {
      throw capabilityTokenError(
        'ISSUANCE_PRECONDITION',
        'Capability scope cannot include actions the assignment does not allow.',
        { action, assignmentId: assignment.id },
      );
    }
  }

  const scope = [...requested];
  if (!scope.includes('view_assigned_task')) {
    // view is required for GET /c/[token]; still must be assignment-allowed (checked above).
    scope.unshift('view_assigned_task');
  }
  return scope;
}

export function toSafeIssuedCapability(capability: TaskCapability): SafeIssuedCapability {
  return {
    id: capability.id,
    taskId: capability.taskId,
    assignmentId: capability.assignmentId,
    permittedActions: [...capability.scope],
    status: capability.status,
    issuedAt: capability.issuedAt,
    expiresAt: capability.expiresAt,
    intendedRecipientEmail: capability.intendedRecipientEmail,
  };
}

/**
 * Owner-authorized capability issuance (no HTTP surface yet).
 * Scope comes from the active assignment; assignment recipient/actions are not rewritten.
 */
export async function issueCapabilityForTask(
  command: IssueCapabilityCommand,
): Promise<IssuedCapabilityResult> {
  return persistIssuance(command, { replaceExisting: false });
}

/**
 * Atomically replace the active capability link for the current assignment.
 * Revokes prior active capability row(s), creates a new one, preserves history.
 */
export async function replaceCapabilityForTask(
  command: ReplaceCapabilityCommand,
): Promise<IssuedCapabilityResult> {
  return persistIssuance(command, { replaceExisting: true });
}

async function persistIssuance(
  command: IssueCapabilityCommand,
  options: { replaceExisting: boolean },
): Promise<IssuedCapabilityResult> {
  const ttlMs = assertValidCapabilityTtlMs(command.ttlMs);
  const pepper = assertValidCapabilityPepper(command.pepper, 'pepper');
  const owner = ownerActor(command.owner.ownerId, command.owner.organizationId);
  const dbRuntime = await loadDbRuntime();

  let current: Task;
  try {
    current = await dbRuntime.getTaskById(command.db, owner.organizationId, command.taskId);
  } catch (error) {
    const persistenceCode = readPersistenceErrorCode(error);
    if (persistenceCode === 'NOT_FOUND' || persistenceCode === 'ORGANIZATION_MISMATCH') {
      throw capabilityTokenError('NOT_FOUND', 'Task not found.', { taskId: command.taskId });
    }
    throw error;
  }

  if (command.expectedVersion !== undefined && current.version !== command.expectedVersion) {
    throw capabilityTokenError(
      'PRECONDITION_FAILED',
      'The resource has changed since the provided ETag.',
      { taskId: command.taskId },
    );
  }

  if (!current.assignment) {
    throw capabilityTokenError(
      'ISSUANCE_PRECONDITION',
      'Task must have an active assignment before issuing a capability.',
      { taskId: command.taskId },
    );
  }

  const assignmentSnapshot: TaskAssignment = { ...current.assignment };
  const scope = resolveCapabilityScopeFromAssignment(assignmentSnapshot, command.scope);
  const writeVersion = command.expectedVersion ?? current.version;

  const existingActive = await dbRuntime.findActiveCapabilitiesForAssignment(
    command.db,
    owner.organizationId,
    assignmentSnapshot.id,
  );

  if (existingActive.length > 0 && !options.replaceExisting) {
    throw capabilityTokenError(
      'ISSUANCE_CONFLICT',
      'Assignment already has an active capability link. Use replaceCapabilityForTask to rotate it.',
      { assignmentId: assignmentSnapshot.id },
    );
  }

  const capabilityId =
    command.capabilityId ?? asCapabilityId(`cap_${generateCapabilityToken().slice(0, 22)}`);

  let domainResult: { task: Task; capability: TaskCapability };
  try {
    domainResult = issueTaskCapability(current, {
      actor: owner,
      now: command.now,
      capabilityId,
      ttlMs,
      scope,
      recipientId: assignmentSnapshot.recipientId,
    });
  } catch (error) {
    throw mapDomainIssuanceError(error);
  }

  // Domain may mirror scope onto the in-memory assignment; persistence must not rewrite assignment actions.
  for (const action of domainResult.capability.scope) {
    if (!scope.includes(action)) {
      throw capabilityTokenError(
        'ISSUANCE_PRECONDITION',
        'Resolved capability scope drifted beyond assignment-allowed actions.',
      );
    }
  }

  const rawToken = generateCapabilityToken(command.random);
  const tokenHash = hashCapabilityToken(rawToken, pepper);
  const capabilityUrl = buildCapabilityUrl(command.appUrl, rawToken);
  const auditAction = options.replaceExisting ? 'replace_task_capability' : 'issue_task_capability';
  const auditId = command.auditId ?? `audit_${auditAction}_${capabilityId}`;

  try {
    const persisted = await command.db.$transaction(async (tx) => {
      const replacedIds = await revokeActiveCapabilitiesInTransaction(
        tx,
        owner.organizationId,
        assignmentSnapshot.id,
        command.now,
        options.replaceExisting ? 'capability_link_replaced' : 'capability_superseded',
      );

      const taskForPersist: Task = {
        ...domainResult.task,
        assignment: {
          ...assignmentSnapshot,
          capabilityStatus: 'active',
          activeCapabilityId: domainResult.capability.id,
          // Preserve Owner-configured recipient actions and recipient identity.
          allowedCapabilityActions: assignmentSnapshot.allowedCapabilityActions,
          recipientId: assignmentSnapshot.recipientId,
          intendedRecipientEmail: assignmentSnapshot.intendedRecipientEmail,
        },
      };

      const task = await dbRuntime.updateTaskWithExpectedVersion(
        tx,
        owner.organizationId,
        // If-Match expectedVersion is enforced atomically here (not only via the pre-transaction read).
        writeVersion,
        taskForPersist,
      );

      await dbRuntime.updateActiveAssignmentCapabilityBinding(tx, owner.organizationId, task.id, {
        activeCapabilityId: domainResult.capability.id,
        capabilityStatus: 'active',
        // Intentionally omit allowedCapabilityActions — issuance must not rewrite them.
      });

      const capability = await dbRuntime.createCapability(
        tx,
        owner.organizationId,
        {
          ...domainResult.capability,
          scope,
          intendedRecipientEmail: assignmentSnapshot.intendedRecipientEmail,
          recipientId: assignmentSnapshot.recipientId,
          assignmentId: assignmentSnapshot.id,
        },
        tokenHash,
      );

      const audit = await dbRuntime.createAuditEvent(tx, {
        id: auditId,
        organizationId: owner.organizationId,
        actorKind: 'owner',
        ownerId: owner.ownerId,
        capabilityId: domainResult.capability.id,
        assignmentId: assignmentSnapshot.id,
        taskId: domainResult.capability.taskId,
        intendedRecipientEmail: assignmentSnapshot.intendedRecipientEmail,
        action: auditAction,
        outcome: 'succeeded',
        resourceVersion: task.version,
        taskStatus: task.status,
        requestId: command.requestId,
        correlationId: command.correlationId ?? undefined,
        note: replacedIds.length > 0 ? `replaced:${replacedIds.join(',')}` : undefined,
        recordedAt: command.now,
      });

      const reloaded = await dbRuntime.getTaskById(tx, owner.organizationId, task.id);
      return { task: reloaded, capability, audit, replacedIds };
    });

    assertNoRawCapabilityToken(persisted.capability, rawToken, 'persisted capability');
    assertNoRawCapabilityToken(persisted.audit, rawToken, 'issuance audit');
    assertNoRawCapabilityToken(JSON.stringify(persisted.audit), tokenHash, 'issuance audit hash');

    const safe = toSafeIssuedCapability({
      ...domainResult.capability,
      scope,
      status: 'active',
    });
    assertNoRawCapabilityToken(JSON.stringify(safe), tokenHash, 'safe issuance hash');

    return {
      capability: safe,
      task: persisted.task,
      rawToken,
      capabilityUrl,
      audit: persisted.audit,
      replacedCapabilityId: persisted.replacedIds[0],
    };
  } catch (error) {
    if (isCapabilityTokenError(error)) {
      throw error;
    }
    const persistenceCode = readPersistenceErrorCode(error);
    if (persistenceCode === 'UNIQUE_VIOLATION') {
      throw capabilityTokenError(
        'ISSUANCE_CONFLICT',
        'Capability token hash conflict during issuance.',
        { taskId: command.taskId },
      );
    }
    if (persistenceCode === 'OPTIMISTIC_CONCURRENCY') {
      throw capabilityTokenError(
        'PRECONDITION_FAILED',
        'The resource has changed since the provided ETag.',
        { taskId: command.taskId },
      );
    }
    throw error;
  }
}

async function revokeActiveCapabilitiesInTransaction(
  tx: DbTransaction,
  organizationId: string,
  assignmentId: string,
  now: UtcInstant,
  reason: string,
): Promise<string[]> {
  const { findActiveCapabilitiesForAssignment, revokeCapabilityRecord } = await loadDbRuntime();
  const actives = await findActiveCapabilitiesForAssignment(tx, organizationId, assignmentId);
  const revokedIds: string[] = [];
  for (const active of actives) {
    await revokeCapabilityRecord(tx, organizationId, active.id, now, reason);
    revokedIds.push(active.id);
  }
  return revokedIds;
}

/**
 * Convenience wrapper that applies an already-loaded CapabilityTokenConfig.
 */
export async function issueCapabilityWithConfig(
  input: Omit<IssueCapabilityCommand, 'ttlMs' | 'pepper' | 'appUrl'> & {
    config: CapabilityTokenConfig;
  },
): Promise<IssuedCapabilityResult> {
  return issueCapabilityForTask({
    ...input,
    ttlMs: input.config.ttlMs,
    pepper: input.config.pepper,
    appUrl: input.config.appUrl,
  });
}

export async function replaceCapabilityWithConfig(
  input: Omit<ReplaceCapabilityCommand, 'ttlMs' | 'pepper' | 'appUrl'> & {
    config: CapabilityTokenConfig;
  },
): Promise<IssuedCapabilityResult> {
  return replaceCapabilityForTask({
    ...input,
    ttlMs: input.config.ttlMs,
    pepper: input.config.pepper,
    appUrl: input.config.appUrl,
  });
}

function mapDomainIssuanceError(error: unknown): CapabilityTokenError {
  if (error instanceof Error) {
    return capabilityTokenError('ISSUANCE_PRECONDITION', error.message);
  }
  return capabilityTokenError('ISSUANCE_PRECONDITION', 'Capability issuance failed.');
}
