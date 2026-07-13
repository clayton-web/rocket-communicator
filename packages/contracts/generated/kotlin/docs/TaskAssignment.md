
# TaskAssignment

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **id** | **kotlin.String** |  |  |
| **recipientId** | **kotlin.String** | Recipient record identifier. Recipients do not have application accounts. |  |
| **intendedRecipientEmail** | **kotlin.String** | Email snapshot at assignment time for audit and delivery. |  |
| **assignedAt** | **kotlin.String** |  |  |
| **assignedByOwnerId** | **kotlin.String** |  |  |
| **allowedCapabilityActions** | [**kotlin.collections.Set&lt;CapabilityAction&gt;**](CapabilityAction.md) | Allowed actions for a specific task capability link. |  |
| **assignmentApprovedAt** | **kotlin.String** | Timestamp of the single bundled assignment approval (D037). |  [optional] |
| **capabilityStatus** | [**CapabilityStatus**](CapabilityStatus.md) | Summary status of the active task capability for this assignment. |  [optional] |
| **deliveryStatus** | [**AssignmentDeliveryStatus**](AssignmentDeliveryStatus.md) |  |  [optional] |
| **activeCapabilityId** | **kotlin.String** | Identifier of the active capability. Raw token is never exposed. |  [optional] |



