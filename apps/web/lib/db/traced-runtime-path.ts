/**
 * Module-global cache of the traced packages/db/dist/runtime.js path.
 * Kept separate so layout diagnostics can read it without importing runtime-db
 * (avoids a cycle through stage-diagnostics).
 */
let lastResolvedTracedRuntimePath: string | undefined;

export function getLastResolvedTracedRuntimePath(): string | undefined {
  return lastResolvedTracedRuntimePath;
}

export function setLastResolvedTracedRuntimePath(runtimePath: string | undefined): void {
  lastResolvedTracedRuntimePath = runtimePath;
}

/** Test-only reset. */
export function resetLastResolvedTracedRuntimePathForTests(): void {
  lastResolvedTracedRuntimePath = undefined;
}
