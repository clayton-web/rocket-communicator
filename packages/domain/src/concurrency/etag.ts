import { preconditionFailed, preconditionRequired } from '../errors/domain-errors.js';

export type ResourceKind = 'task' | 'task-suggestion';

export function formatETag(kind: ResourceKind, resourceId: string, version: number): string {
  return `"${kind}-${resourceId}-v${version}"`;
}

export function parseETag(
  etag: string,
): { kind: ResourceKind; resourceId: string; version: number } | null {
  const match = /^"(task-suggestion|task)-([^"]+)-v(\d+)"$/.exec(etag);
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
