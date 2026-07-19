
# HandoffTaskResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **task** | [**Task**](Task.md) | Updated Task including assignment attribute after a **successful** handoff (&#x60;deliveryStatus&#x3D;sent&#x60;). Version/etag reflect the post-handoff Task concurrency token.  |  |
| **deliveryPath** | [**HandoffDeliveryPath**](HandoffDeliveryPath.md) |  |  |
| **deliveryStatus** | [**AssignmentDeliveryStatus**](AssignmentDeliveryStatus.md) | On HTTP 200 success this value is &#x60;sent&#x60; (Gmail accepted the outbound send). &#x60;pending&#x60; and &#x60;failed&#x60; are not returned as successful handoff responses (D092, D042).  |  |
| **recipient** | [**Recipient**](Recipient.md) | Owner-visible Recipient summary for the handoff target. |  |
| **capabilityId** | **kotlin.String** | Identifier of the capability issued for this handoff. Raw capability secret is **not** returned on routine handoff — delivery is by email/forward (D063, D094). Administrative raw-token reveal remains &#x60;POST /api/v1/tasks/{taskId}/capabilities&#x60; only.  |  |
| **requiresSendReconsent** | **kotlin.Boolean** | Always &#x60;false&#x60; on HTTP 200 success. When handoff fails for missing &#x60;gmail.send&#x60;, clients should read connection status (&#x60;requiresSendReconsent&#x60;) and complete OAuth re-consent.  |  |
| **idempotentReplay** | **kotlin.Boolean** | &#x60;true&#x60; when this response replays a prior successful handoff for the same Idempotency-Key and matching request payload. &#x60;false&#x60; for a newly completed handoff.  |  |



