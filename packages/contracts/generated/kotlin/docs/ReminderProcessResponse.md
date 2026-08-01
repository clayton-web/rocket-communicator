
# ReminderProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **deliveryEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_REMINDER_DELIVERY&#x60; was exactly \&quot;true\&quot;. False in every environment in this milestone.  |  |
| **schedulesScanned** | **kotlin.Int** |  |  |
| **occurrencesClaimed** | **kotlin.Int** |  |  |
| **delivered** | **kotlin.Int** | Occurrences a transport accepted. Counts fake-transport acceptances only. |  |
| **skipped** | **kotlin.Int** | Occurrences a pre-send eligibility check truthfully refused. |  |
| **failedRetryable** | **kotlin.Int** | Definite rejections that leave the occurrence owed and retryable. |  |
| **failedPermanent** | **kotlin.Int** |  |  |
| **ambiguous** | **kotlin.Int** | Occurrences whose result could not be determined. Terminal and never retried.  |  |
| **recoveredClaims** | **kotlin.Int** | Abandoned occurrence claims released or finalized before this batch ran. |  |
| **ceilingStops** | **kotlin.Int** | Schedules stopped by reaching the D106 overdue delivery ceiling. |  |
| **requestId** | **kotlin.String** |  |  |



