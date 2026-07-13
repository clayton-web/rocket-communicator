
# ApproveTaskSuggestionRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **acknowledgement** | [**inline**](#Acknowledgement) | Primary user intent approving the edited suggestion and administrator assignment. Future server logic derives task creation, reminder scheduling, Gmail forwarding, and standard assignment email without client-side side-effect toggles.  |  |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  [optional] |
| **assigneeUserId** | **kotlin.String** | Selected assignee for the approved task and assignment. |  [optional] |
| **priority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **dueAt** | **kotlin.String** |  |  [optional] |


<a id="Acknowledgement"></a>
## Enum: acknowledgement
| Name | Value |
| ---- | ----- |
| acknowledgement | assignment_approved |



