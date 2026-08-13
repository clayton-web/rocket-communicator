
# TaskReminderState

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **taskId** | **kotlin.String** |  |  |
| **etag** | **kotlin.String** | Strong ETag for the *reminder* resource, required as &#x60;If-Match&#x60; on PUT and DELETE. Distinct from the Task ETag: a reminder change deliberately does not bump &#x60;Task.version&#x60;, so a Task ETag cannot detect that reminder state moved. Opaque — clients must echo it, not parse it. Also returned in the &#x60;ETag&#x60; response header.  |  |
| **state** | [**TaskReminderScheduleState**](TaskReminderScheduleState.md) | Authoritative for whether reminders will be sent. &#x60;advance&#x60; and &#x60;nextOverdueOccurrence&#x60; describe the current generation&#39;s recorded decisions; when &#x60;state&#x60; is &#x60;stopped&#x60; those are history and nothing further will be delivered.  |  |
| **requiresOwnerAttention** | **kotlin.Boolean** | Whether the schedule needs an Owner decision, for example after the overdue ceiling (D106, D108). |  |
| **dueLocalDate** | **kotlin.String** |  |  [optional] |
| **schedulingTimeZone** | **kotlin.String** |  |  [optional] |
| **generation** | **kotlin.Int** |  |  [optional] |
| **advance** | [**TaskReminderAdvance**](TaskReminderAdvance.md) |  |  [optional] |
| **nextOverdueOccurrence** | [**TaskReminderOccurrence**](TaskReminderOccurrence.md) |  |  [optional] |
| **overdueDeliveredCount** | **kotlin.Int** |  |  [optional] |
| **stopReason** | [**TaskReminderStopReason**](TaskReminderStopReason.md) |  |  [optional] |
| **advanceEnabled** | **kotlin.Boolean** |  |  [optional] |



