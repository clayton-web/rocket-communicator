import type { UtcInstant } from '../types/timestamps.js';
import type { TaskSuggestionStatus } from '../entities/task-suggestion.js';
import { computeExcerptPurgeAt, computeWorkflowSafetyCeilingPurgeAt } from './calculators.js';

/**
 * One TaskSuggestion's D082 retention claim on a temporary communication excerpt.
 *
 * Source-neutral on purpose. An A6 Gmail suggestion reaching its excerpt through
 * `sourceCommunicationEventId`, a Gmail Review proposal, and a Google Messages Review proposal all
 * describe the same thing here — how long *this* proposal still needs the excerpt to exist. Which
 * column carried the linkage is a persistence question and is answered before this type is built.
 */
export type ExcerptEntitlementHolder = {
  suggestionId: string;
  status: TaskSuggestionStatus;
  /** When the proposal was created against the excerpt — D082's `associatedAt`. */
  associatedAt: UtcInstant;
  /** Suggestion terminal instant (dismiss or merge). Null while pending or approved. */
  suggestionTerminalAt: UtcInstant | null;
  /** Approve instant — the resulting Task's creation. Null unless approved. */
  approvedAt: UtcInstant | null;
  /** Resulting Task terminal instant. Null while that Task is still active. */
  taskTerminalAt: UtcInstant | null;
};

/**
 * How long one proposal still entitles its excerpt to exist (D082, D020).
 *
 * Every branch is anchored to an instant the transition itself established, never to "now", so an
 * entitlement is written once and does not drift. That is what makes the approved ceiling a real
 * bound: an approved proposal's entitlement is `approvedAt + 30 days` no matter how much ordinary
 * activity the resulting Task later sees, and it is replaced only when that Task goes terminal.
 */
export function computeExcerptEntitlementPurgeAt(holder: ExcerptEntitlementHolder): UtcInstant {
  switch (holder.status) {
    case 'dismissed':
    case 'merged':
      return computeExcerptPurgeAt(holder.suggestionTerminalAt ?? holder.associatedAt);
    case 'approved':
      return holder.taskTerminalAt
        ? computeExcerptPurgeAt(holder.taskTerminalAt)
        : computeWorkflowSafetyCeilingPurgeAt(holder.approvedAt ?? holder.associatedAt);
    case 'pending':
      return computeWorkflowSafetyCeilingPurgeAt(holder.associatedAt);
  }
}

/**
 * The excerpt's aggregate deadline: the **maximum** entitlement across every proposal holding a
 * claim on it (D082, D161).
 *
 * Maximum rather than "the transitioning proposal's own value", because siblings from one imported
 * source are independent workflows. A dismissed sibling must not drag the excerpt out from under an
 * approved one, and when the longest entitlement itself becomes terminal the aggregate is allowed to
 * shorten to whatever remains. Expired entitlements need no special case: they simply lose the
 * comparison, and an excerpt whose every entitlement has lapsed becomes purge-eligible on its own.
 *
 * `transitionEntitlements` lets the lifecycle transition in flight supply its own already-computed
 * value instead of having it re-derived from the row it just wrote. That keeps A6, whose unique
 * linkage means exactly one holder, byte-identical to its pre-existing behaviour: the maximum of one
 * caller-supplied value is that value.
 *
 * Returns null when nothing holds a claim. That is not "no change" — it means no entitlement exists,
 * so the caller leaves the excerpt's initial ingest or Review deadline alone. A zero-proposal
 * interpretation is the ordinary way to reach it.
 */
export function resolveExcerptPurgeAt(input: {
  holders: readonly ExcerptEntitlementHolder[];
  transitionEntitlements?: ReadonlyMap<string, UtcInstant>;
}): UtcInstant | null {
  const claimed = new Set<string>();
  let latest: UtcInstant | null = null;

  const consider = (entitlement: UtcInstant): void => {
    if (latest === null || Date.parse(entitlement) > Date.parse(latest)) {
      latest = entitlement;
    }
  };

  for (const holder of input.holders) {
    claimed.add(holder.suggestionId);
    consider(
      input.transitionEntitlements?.get(holder.suggestionId) ??
        computeExcerptEntitlementPurgeAt(holder),
    );
  }

  // A transition may name a proposal the holder read did not return — a linkage written in a
  // statement this transaction has not yet observed, for instance. Honour it rather than silently
  // discarding an entitlement the caller has already committed to.
  for (const [suggestionId, entitlement] of input.transitionEntitlements ?? []) {
    if (!claimed.has(suggestionId)) {
      consider(entitlement);
    }
  }

  return latest;
}
