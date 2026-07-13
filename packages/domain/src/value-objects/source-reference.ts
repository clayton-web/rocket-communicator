import type { UtcInstant } from '../types/timestamps.js';

export type SourceType =
  'gmail' | 'google_messages' | 'missed_call' | 'completed_call' | 'manual' | 'voice';

export interface ExternalIdentifier {
  provider: string;
  idType: string;
  id: string;
}

export interface TemporaryExcerptRef {
  excerptId: string;
  byteLength?: number;
  contentClassification: 'temporary_communication';
}

export interface SourceReference {
  id: string;
  sourceType: SourceType;
  dedupeKey: string;
  externalIds?: ExternalIdentifier[];
  title?: string;
  excerptRef?: TemporaryExcerptRef;
  link?: string;
  capturedAt: UtcInstant;
  contactHint?: string;
}
