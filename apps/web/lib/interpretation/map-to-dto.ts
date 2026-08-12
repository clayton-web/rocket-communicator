import { mapSuggestionToDto } from '@/lib/capability/map-to-dto';
import type { components } from '@aicaa/contracts/schema';
import type { InterpretationServiceResult } from './service';

export type ManualCaptureResponseDto = components['schemas']['ManualCaptureResponse'];

/**
 * Map an interpretation outcome onto the public manual-capture response (S3.2 / D170).
 *
 * The response is built field by field rather than spread from the service result, so growth in the
 * service's own shape cannot silently become published API. `occurrence.sourceKind` stays unpublished
 * because the route already fixed it, and `occurrence.outcome` because it only restates whether the
 * returned array is empty. What remains is the caller's usable truth: whether this was a replay,
 * when the interpretation committed, and the canonical proposals themselves.
 *
 * Proposals go through the existing canonical `TaskSuggestion` mapper. There is no second proposal
 * DTO, and interpretation provenance — run id, request fingerprint, idempotency key, model and
 * policy version, raw input — is absent because it never reaches this layer to begin with.
 */
export function mapManualCaptureResponse(
  result: InterpretationServiceResult,
): ManualCaptureResponseDto {
  return {
    idempotentReplay: result.outcome === 'replayed',
    interpretedAt: result.occurrence.interpretedAt,
    taskSuggestions: result.suggestions.map(mapSuggestionToDto),
  };
}
