import type { RecipientId } from '../types/ids.js';

export interface Recipient {
  id: RecipientId;
  displayName: string;
  email: string;
  relationshipLabel?: string;
  active: boolean;
  reminderPreferences?: {
    emailEnabled?: boolean;
  };
  assignmentCategories?: string[];
}
