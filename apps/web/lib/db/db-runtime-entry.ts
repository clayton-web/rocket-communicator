import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Production DB runtime bridge.
 *
 * Resolved at runtime via dynamic import into traced packages/db/dist output.
 * Production Lambda code must not resolve the workspace package name at runtime.
 *
 * Runtime loading is deferred until loadTracedRuntimeModule() is called so route
 * module import cannot throw before application error handling runs.
 */
const TRACED_RUNTIME_RELATIVE = path.join('packages', 'db', 'dist', 'runtime.js');

function walkUpForTracedRuntime(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 24; depth += 1) {
    const candidate = path.join(dir, TRACED_RUNTIME_RELATIVE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

export function resolveTracedRuntimePath(moduleUrl?: string): string {
  const cwdCandidate = path.join(process.cwd(), TRACED_RUNTIME_RELATIVE);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  if (moduleUrl) {
    try {
      const fromModuleUrl = walkUpForTracedRuntime(path.dirname(fileURLToPath(moduleUrl)));
      if (fromModuleUrl) {
        return fromModuleUrl;
      }
    } catch {
      // Ignore invalid moduleUrl values and continue with other anchors.
    }
  }

  const fromCwdWalk = walkUpForTracedRuntime(process.cwd());
  if (fromCwdWalk) {
    return fromCwdWalk;
  }

  throw new Error(`Traced DB runtime not found at ${TRACED_RUNTIME_RELATIVE}`);
}

type TracedRuntimeModule = typeof import('../../../../packages/db/dist/runtime.js');

export async function loadTracedRuntimeModule(): Promise<TracedRuntimeModule> {
  const runtimePath = resolveTracedRuntimePath(import.meta.url);
  return import(pathToFileURL(runtimePath).href) as Promise<TracedRuntimeModule>;
}
