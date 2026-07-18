
# ApproveTaskSuggestionRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **acknowledgement** | [**inline**](#Acknowledgement) | Owner confirms creating an unassigned Task from this suggestion (D080). Does not approve Recipient assignment, capability issuance, assignment email, Gmail forward, or reminder scheduling.  |  |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  [optional] |
| **recipientId** | **kotlin.String** | Must not be sent in A6. If present, the server returns HTTP 400 with error code RECIPIENT_HANDOFF_NOT_AVAILABLE (D080). Recipient assignment, capability issuance, assignment email, and Gmail forward remain A7 (D037).  |  [optional] |
| **priority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **dueAt** | **kotlin.String** |  |  [optional] |


<a id="Acknowledgement"></a>
## Enum: acknowledgement
| Name | Value |
| ---- | ----- |
| acknowledgement | suggestion_approved |



