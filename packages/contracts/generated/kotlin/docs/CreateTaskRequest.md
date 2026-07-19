
# CreateTaskRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  |
| **recipientId** | **kotlin.String** | **Deprecated (D091).** Silent create-with-assignment path retained for A4 compatibility until A7 handoff implementation rejects it. New clients must create an **unassigned** Task and call &#x60;POST /api/v1/tasks/{taskId}/handoff&#x60;. Suggestion approval already produces unassigned Tasks only (D080). Do not treat this field as the recommended assignment path.  |  [optional] |
| **dueAt** | **kotlin.String** |  |  [optional] |
| **priority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **sourceReference** | [**SourceReference**](SourceReference.md) |  |  [optional] |



