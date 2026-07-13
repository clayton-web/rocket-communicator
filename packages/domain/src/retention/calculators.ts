import { MS_PER_DAY, addMilliseconds, type UtcInstant } from '../types/timestamps.js';
import type { RetentionMetadata } from '../value-objects/metadata.js';

const SEVEN_DAYS_MS = 7 * MS_PER_DAY;
const THIRTY_DAYS_MS = 30 * MS_PER_DAY;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export function computeExcerptPurgeAt(completedOrDismissedAt: UtcInstant): UtcInstant {
  return addMilliseconds(completedOrDismissedAt, SEVEN_DAYS_MS);
}

export function computeVisibleUntil(completedAt: UtcInstant): UtcInstant {
  return addMilliseconds(completedAt, THIRTY_DAYS_MS);
}

export function computeContentScrubAt(completedAt: UtcInstant): UtcInstant {
  return computeVisibleUntil(completedAt);
}

export function computeSuccessfulAudioDeletionAt(transcriptionValidatedAt: UtcInstant): UtcInstant {
  return transcriptionValidatedAt;
}

export function computeFailedAudioDeleteAt(failedAt: UtcInstant): UtcInstant {
  return addMilliseconds(failedAt, FORTY_EIGHT_HOURS_MS);
}

export function buildCompletionRetention(completedAt: UtcInstant): RetentionMetadata {
  return {
    excerptPurgeAt: computeExcerptPurgeAt(completedAt),
    visibleUntil: computeVisibleUntil(completedAt),
    contentScrubAt: computeContentScrubAt(completedAt),
    failedAudioDeleteAt: null,
  };
}

export function buildDismissalRetention(dismissedAt: UtcInstant): RetentionMetadata {
  return {
    excerptPurgeAt: computeExcerptPurgeAt(dismissedAt),
    visibleUntil: null,
    contentScrubAt: null,
    failedAudioDeleteAt: null,
  };
}
