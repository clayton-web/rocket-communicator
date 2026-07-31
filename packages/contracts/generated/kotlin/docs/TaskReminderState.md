
# TaskReminderState

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **taskId** | **kotlin.String** |  |  |
| **state** | [**TaskReminderScheduleState**](TaskReminderScheduleState.md) | Authoritative for whether reminders will be sent. &#x60;advance&#x60; and &#x60;nextOverdueOccurrence&#x60; describe the current generation&#39;s recorded decisions; when &#x60;state&#x60; is &#x60;stopped&#x60; those are history and nothing further will be delivered.  |  |
| **requiresOwnerAttention** | **kotlin.Boolean** | Whether the schedule needs an Owner decision, for example after the overdue ceiling (D106, D108). |  |
| **dueLocalDate** | **kotlin.String** |  |  [optional] |
| **schedulingTimeZone** | **kotlin.String** |  |  [optional] |
| **generation** | **kotlin.Int** |  |  [optional] |
| **advance** | [**TaskReminderAdvance**](TaskReminderAdvance.md) |  |  [optional] |
| **nextOverdueOccurrence** | [**TaskReminderOccurrence**](TaskReminderOccurrence.md) |  |  [optional] |
| **overdueDeliveredCount** | **kotlin.Int** |  |  [optional] |
| **stopReason** | [**TaskReminderStopReason**](TaskReminderStopReason.md) |  |  [optional] |



