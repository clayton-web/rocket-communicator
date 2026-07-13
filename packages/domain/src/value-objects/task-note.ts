import type { UtcInstant } from '../types/timestamps.js';
import type { ActionAttribution } from './capability.js';

export interface TaskNote {
  id: string;
  attribution: ActionAttribution;
  body: string;
  createdAt: UtcInstant;
}
