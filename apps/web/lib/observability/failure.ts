import { classifyOperationalFailure, type OperationalFailureCategory } from './classify';
import { emitOperationalLog } from './log';
import { getRequestId } from './request-context';
import { toSafeRouteTemplate } from './route-template';

const EXPECTED_CLIENT_OUTCOME_CATEGORIES = new Set<OperationalFailureCategory>([
  'AUTH_FAILURE',
  'AUTHZ_FAILURE',
  'VALIDATION_FAILURE',
  'CONCURRENCY_CONFLICT',
  'AMBIGUOUS_OUTCOME',
]);

/**
 * Emit a privacy-safe operational failure diagnostic (always on; D115).
 * Uses a safe route template — never a raw capability path (D114).
 *
 * Expected client-facing outcomes (authz, validation, concurrency) are not
 * logged as operational failures — they remain measurable via timing
 * `outcome: 'error'` only. Infrastructure and unknown failures are logged.
 */
export function logOperationalFailure(
  error: unknown,
  context: {
    routePathname?: string;
    operation?: string;
    requestId?: string;
    category?: OperationalFailureCategory;
    /** Force emit even for expected client outcomes (tests / explicit probes). */
    force?: boolean;
  } = {},
): void {
  const category = context.category ?? classifyOperationalFailure(error);
  if (!context.force && EXPECTED_CLIENT_OUTCOME_CATEGORIES.has(category)) {
    return;
  }
  emitOperationalLog({
    event: 'operational_failure',
    level: 'error',
    category,
    operation: context.operation,
    requestId: context.requestId ?? getRequestId(),
    routeTemplate: context.routePathname ? toSafeRouteTemplate(context.routePathname) : undefined,
    outcome: 'error',
  });
}
