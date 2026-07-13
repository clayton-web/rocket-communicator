import type { UtcInstant } from '../types/timestamps.js';

export interface ReminderMetadata {
  nextReminderAt?: UtcInstant | null;
  paused: boolean;
  pausedReason?: 'waiting' | 'completed' | 'dismissed' | null;
}

export interface RetentionMetadata {
  excerptPurgeAt?: UtcInstant | null;
  visibleUntil?: UtcInstant | null;
  contentScrubAt?: UtcInstant | null;
  failedAudioDeleteAt?: UtcInstant | null;
}
