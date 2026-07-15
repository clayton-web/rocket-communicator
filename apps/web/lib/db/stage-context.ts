export interface DbStageContext {
  routePathname?: string;
  requestId?: string;
}

let activeContext: DbStageContext | undefined;

/** Bind route context for stage diagnostics within a single Owner task request. */
export function setDbStageContext(context: DbStageContext | undefined): void {
  activeContext = context;
}

export function getDbStageContext(): DbStageContext | undefined {
  return activeContext;
}

/** Test-only reset. */
export function resetDbStageContextForTests(): void {
  activeContext = undefined;
}
