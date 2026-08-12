
# ApproveTaskSuggestionRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **responsibility** | [**ResponsibilitySelection**](ResponsibilitySelection.md) | Required (D168). Every successful acceptance must carry affirmative evidence of the Owner&#39;s initial responsibility choice, so omitting this returns HTTP 400 VALIDATION_ERROR and approves nothing. An omitted selection is never defaulted or inferred to &#x60;owner&#x60;: absence of a selection, of a Recipient, or of a TaskAssignment is never evidence that the Owner selected Me (D155, D164).  |  |
| **acknowledgement** | [**inline**](#Acknowledgement) | Owner confirms creating an unassigned Task from this suggestion (D080). Does not approve Recipient assignment, capability issuance, assignment email, Gmail forward, or reminder scheduling.  |  |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  [optional] |
| **recipientId** | **kotlin.String** | Must not be sent in A6. If present, the server returns HTTP 400 with error code RECIPIENT_HANDOFF_NOT_AVAILABLE (D080). Recipient assignment, capability issuance, assignment email, and Gmail forward remain A7 (D037). This field is not the responsibility-selection channel — use &#x60;responsibility&#x60;.  |  [optional] |
| **priority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **dueAt** | **kotlin.String** |  |  [optional] |


<a id="Acknowledgement"></a>
## Enum: acknowledgement
| Name | Value |
| ---- | ----- |
| acknowledgement | suggestion_approved |



