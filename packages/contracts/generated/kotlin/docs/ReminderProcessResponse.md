
# ReminderProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **deliveryEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_REMINDER_DELIVERY&#x60; was exactly \&quot;true\&quot;. False in every environment in this milestone.  |  |
| **transportConfigured** | **kotlin.Boolean** | Whether a transport was injected. False means the invocation failed closed and did no work at all: no real transport exists in this milestone, and processing refuses to run rather than manufacturing a fake that would report deliveries it never made.  |  |
| **schedulesScanned** | **kotlin.Int** |  |  |
| **occurrencesClaimed** | **kotlin.Int** |  |  |
| **claimRefusals** | **kotlin.Int** | Occurrences a claim was refused for — held by another worker, already terminal, or out of retry budget. Ordinary contention; a persistently non-zero value alongside zero claims is the signature of a stuck occurrence.  |  |
| **delivered** | **kotlin.Int** | Occurrences a transport accepted. Counts fake-transport acceptances only. |  |
| **skipped** | **kotlin.Int** | Occurrences a pre-send eligibility check truthfully refused. |  |
| **failedRetryable** | **kotlin.Int** | Definite rejections that leave the occurrence owed and retryable. |  |
| **failedPermanent** | **kotlin.Int** |  |  |
| **ambiguous** | **kotlin.Int** | Occurrences whose result could not be determined. Terminal and never retried.  |  |
| **recoveredClaims** | **kotlin.Int** | Abandoned occurrence claims released or finalized before this batch ran. |  |
| **retryBudgetTerminalizations** | **kotlin.Int** | Occurrences that had spent their retry budget without reaching a terminal outcome and were terminalized as permanent failures. Non-zero means a worker died mid-attempt at some point; a schedule left in that state would otherwise be re-scanned indefinitely.  |  |
| **unsettledOccurrencesSettled** | **kotlin.Int** | Terminal occurrences whose schedule settlement had not completed, and was completed by this invocation. Non-zero means a previous invocation died between recording an outcome and applying it to the schedule.  |  |
| **settlementsDeferred** | **kotlin.Int** | Schedule settlements this invocation could not complete. The occurrence outcomes are recorded and durable regardless; the debt is picked up by a later invocation.  |  |
| **ceilingStops** | **kotlin.Int** | Schedules stopped by reaching the D106 overdue delivery ceiling. |  |
| **deadlineStopped** | **kotlin.Boolean** | Whether the invocation stopped at its soft deadline with work still outstanding. The remaining work is durable and picked up by the next invocation.  |  |
| **requestId** | **kotlin.String** |  |  |



