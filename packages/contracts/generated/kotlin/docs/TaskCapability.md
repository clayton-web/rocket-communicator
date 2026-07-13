
# TaskCapability

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **id** | **kotlin.String** | Capability identifier. Raw token is stored only as a secure hash server-side. |  |
| **taskId** | **kotlin.String** |  |  |
| **assignmentId** | **kotlin.String** |  |  |
| **intendedRecipientEmail** | **kotlin.String** | Intended recipient at issuance. Not verified actor identity. |  |
| **scope** | [**kotlin.collections.Set&lt;CapabilityAction&gt;**](CapabilityAction.md) | Allowed actions for a specific task capability link. |  |
| **status** | [**CapabilityStatus**](CapabilityStatus.md) |  |  |
| **issuedAt** | **kotlin.String** |  |  |
| **expiresAt** | **kotlin.String** |  |  |
| **recipientId** | **kotlin.String** |  |  [optional] |
| **revokedAt** | **kotlin.String** |  |  [optional] |
| **lastUsedAt** | **kotlin.String** |  |  [optional] |



