
# CapabilityAuditContext

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **capabilityId** | **kotlin.String** |  |  |
| **assignmentId** | **kotlin.String** |  |  |
| **taskId** | **kotlin.String** |  |  |
| **intendedRecipientEmail** | **kotlin.String** | Intended recipient for the link. Not verified actor identity. |  |
| **action** | [**CapabilityAction**](CapabilityAction.md) |  |  |
| **recordedAt** | **kotlin.String** |  |  |
| **outcome** | [**inline**](#Outcome) | Result of the authorization/mutation attempt for audit (D057). |  |
| **resourceVersion** | **kotlin.Int** | Task version observed or written for state/version context (D057). |  [optional] |
| **taskStatus** | **kotlin.String** | Task status context for audit (D057). |  [optional] |
| **note** | **kotlin.String** |  |  [optional] |
| **requestId** | **kotlin.String** |  |  [optional] |
| **correlationId** | **kotlin.String** |  |  [optional] |
| **attributionLabel** | **kotlin.String** | Human-readable audit wording such as \&quot;Action submitted through link sent to recipient@example.com\&quot;. Must not claim a verified person performed the action.  |  [optional] |


<a id="Outcome"></a>
## Enum: outcome
| Name | Value |
| ---- | ----- |
| outcome | succeeded, denied, failed |



