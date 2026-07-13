import type { AssignmentId, OwnerId, RecipientId } from '../types/ids.js';
import type { UtcInstant } from '../types/timestamps.js';
import type { AssignmentDeliveryStatus, CapabilityAction, CapabilityStatus } from './capability.js';

export interface TaskAssignment {
  id: AssignmentId;
  recipientId: RecipientId;
  intendedRecipientEmail: string;
  assignedAt: UtcInstant;
  assignedByOwnerId: OwnerId;
  assignmentApprovedAt?: UtcInstant;
  allowedCapabilityActions: CapabilityAction[];
  capabilityStatus?: CapabilityStatus;
  deliveryStatus?: AssignmentDeliveryStatus;
  activeCapabilityId?: string | null;
}
