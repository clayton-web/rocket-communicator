
# TaskSuggestion

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **id** | **kotlin.String** |  |  |
| **organizationId** | **kotlin.String** |  |  |
| **status** | [**TaskSuggestionStatus**](TaskSuggestionStatus.md) |  |  |
| **summaryPoints** | [**kotlin.collections.List&lt;TaskSummaryPoint&gt;**](TaskSummaryPoint.md) |  |  |
| **version** | **kotlin.Int** |  |  |
| **etag** | **kotlin.String** |  |  |
| **createdAt** | **kotlin.String** |  |  |
| **updatedAt** | **kotlin.String** |  |  |
| **sourceReference** | [**SourceReference**](SourceReference.md) |  |  [optional] |
| **proposedRecipientId** | **kotlin.String** | Optional AI- or work-request-proposed Recipient. Informational in A6. Approving with recipientId is rejected (D080); Recipient handoff is A7 (D037).  |  [optional] |
| **proposedDueAt** | **kotlin.String** |  |  [optional] |
| **proposedPriority** | [**TaskPriority**](TaskPriority.md) |  |  [optional] |
| **voiceOriginated** | **kotlin.Boolean** |  |  [optional] |
| **mergedIntoTaskId** | **kotlin.String** |  |  [optional] |
| **approvedTaskId** | **kotlin.String** | Canonical Task ID created when this suggestion was approved. Null while pending / unapproved. Exposed on Owner TaskSuggestion list and detail reads so a client that lost the approve success response can recover via read-after-write against the existing persistence linkage. Not responsibility, assignment, handoff, or custody state, and never synthesized from those surfaces.  |  [optional] |
| **retention** | [**RetentionMetadata**](RetentionMetadata.md) |  |  [optional] |



