import type { UserId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';

export interface TaskNote {
  id: string;
  authorUserId: UserId;
  body: string;
  createdAt: UtcInstant;
}
