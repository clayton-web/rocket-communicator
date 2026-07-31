import { preconditionFailed, preconditionRequired } from '../errors/domain-errors.js';

/**
 * `task-reminder` is scoped by Task id but versioned independently of the Task.
 *
 * A reminder mutation deliberately does not bump `Task.version` — the due date is not part of the
 * Task contract — so a Task ETag cannot detect that reminder state moved underneath a caller. The
 * reminder resource therefore carries its own version, and its own token kind so the two can never
 * be confused for one another.
 */
export type ResourceKind = 'task' | 'task-suggestion' | 'task-reminder';

export function formatETag(kind: ResourceKind, resourceId: string, version: number): string {
  return `"${kind}-${resourceId}-v${version}"`;
}

export function parseETag(
  etag: string,
): { kind: ResourceKind; resourceId: string; version: number } | null {
  // `task-reminder` and `task-suggestion` precede `task`: the alternation is ordered so the longer
  // prefixes win, otherwise `"task-reminder-abc-v1"` would parse as kind `task`, id
  // `reminder-abc`.
  const match = /^"(task-reminder|task-suggestion|task)-([^"]+)-v(\d+)"$/.exec(etag);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] as ResourceKind,
    resourceId: match[2],
    version: Number.parseInt(match[3], 10),
  };
}

export function assertMatchingPrecondition(
  ifMatch: string | undefined,
  expected: { kind: ResourceKind; resourceId: string; version: number },
): void {
  if (!ifMatch) {
    throw preconditionRequired('If-Match header is required for this mutation.');
  }
  const parsed = parseETag(ifMatch);
  if (!parsed) {
    throw preconditionFailed('If-Match header is not a valid strong ETag.');
  }
  if (
    parsed.kind !== expected.kind ||
    parsed.resourceId !== expected.resourceId ||
    parsed.version !== expected.version
  ) {
    throw preconditionFailed('The resource has changed since the provided ETag.');
  }
}
