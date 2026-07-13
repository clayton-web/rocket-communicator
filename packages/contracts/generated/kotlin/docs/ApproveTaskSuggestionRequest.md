
# ApproveTaskSuggestionRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **acknowledgement** | [**inline**](#Acknowledgement) | Owner intent approving the edited suggestion and Recipient assignment. Future server logic derives task creation, reminder scheduling, Gmail forwarding, capability link issuance, and standard assignment email without client-side side-effect toggles.  |  |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  [optional] |
| **recipientId** | **kotlin.String** | Selected Recipient for the approved task and assignment. |  [optional] |
| **priority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **dueAt** | **kotlin.String** |  |  [optional] |


<a id="Acknowledgement"></a>
## Enum: acknowledgement
| Name | Value |
| ---- | ----- |
| acknowledgement | assignment_approved |



