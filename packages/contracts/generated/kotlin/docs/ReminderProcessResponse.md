
# ReminderProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **deliveryEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_REMINDER_DELIVERY&#x60; was exactly \&quot;true\&quot;. False in every environment in this milestone.  |  |
| **transportConfigured** | **kotlin.Boolean** | Whether a transport was available to send through. False means the invocation failed closed and did no work at all: processing refuses to run rather than manufacturing a transport that would report deliveries it never made. Also false whenever delivery is disabled, because no transport is constructed at all in that case.  |  |
| **transportAuthorized** | **kotlin.Boolean** | Whether this invocation held a usable provider authorization when it began scanning.  Only meaningful when &#x60;deliveryEnabled&#x60; and &#x60;transportConfigured&#x60; are both true. It is false by default in the other two cases, where authorization was never attempted at all, so the three flags must be read as a triple: (false, false, false) is delivery disabled, (true, false, false) is delivery enabled with nothing to send through, (true, true, false) is authorization unusable, and (true, true, true) is an invocation that scanned.  False with the first two true means the Owner&#39;s Gmail connection is missing, has not granted the send scope, or could not produce an access token, and the invocation stopped before its first claim: no occurrence was created, no schedule moved, and no provider was contacted. Authorization is resolved once per invocation and always before any claim, so an unusable connection is never charged to a Task as a delivery failure. Which of those causes applied is deliberately not reported here.  |  |
| **schedulesScanned** | **kotlin.Int** | Due occurrences the two scans returned, not distinct schedules (A8.4b.3). A schedule that owes both its advance morning and an overdue morning in the same invocation — which needs an outage long enough for the due date itself to pass — is counted once per occurrence, because each is claimed, guarded, and settled separately.  |  |
| **occurrencesClaimed** | **kotlin.Int** |  |  |
| **claimRefusals** | **kotlin.Int** | Occurrences a claim was refused for — held by another worker, already terminal, or out of retry budget. Ordinary contention; a persistently non-zero value alongside zero claims is the signature of a stuck occurrence.  |  |
| **delivered** | **kotlin.Int** | Occurrences a transport confirmed it accepted. Never an ambiguous outcome: a send whose result could not be determined is counted under &#x60;ambiguous&#x60; and is never reported here.  |  |
| **skipped** | **kotlin.Int** | Occurrences a pre-send eligibility check truthfully refused. |  |
| **failedRetryable** | **kotlin.Int** | Definite rejections that leave the occurrence owed and retryable. |  |
| **failedPermanent** | **kotlin.Int** |  |  |
| **ambiguous** | **kotlin.Int** | Occurrences whose result could not be determined. Terminal and never retried.  |  |
| **recoveredClaims** | **kotlin.Int** | Abandoned occurrence claims released or finalized before this batch ran. |  |
| **retryBudgetTerminalizations** | **kotlin.Int** | Occurrences that had spent their retry budget without reaching a terminal outcome and were terminalized as permanent failures. Non-zero means a worker died mid-attempt at some point; a schedule left in that state would otherwise be re-scanned indefinitely.  |  |
| **unsettledOccurrencesSettled** | **kotlin.Int** | Terminal occurrences whose schedule settlement had not completed, and was completed by this invocation. Non-zero means a previous invocation died between recording an outcome and applying it to the schedule.  |  |
| **settlementsDeferred** | **kotlin.Int** | Schedule settlements this invocation could not complete. The occurrence outcomes are recorded and durable regardless; the debt is picked up by a later invocation.  |  |
| **ceilingStops** | **kotlin.Int** | Schedules stopped by reaching the D106 overdue delivery ceiling. |  |
| **ambiguityStops** | **kotlin.Int** | Schedules stopped by D129 — a third consecutive terminal ambiguous overdue occurrence in one generation.  Reported separately from &#x60;ceilingStops&#x60; because the two mean opposite things. A ceiling stop is a schedule that finished its work; an ambiguity stop is the system reporting that it cannot tell whether the last three reminders reached anyone. Non-zero here is the signal to inspect the provider path, not the affected Tasks.  |  |
| **deadlineStopped** | **kotlin.Boolean** | Whether the invocation stopped at its soft deadline with work still outstanding. The remaining work is durable and picked up by the next invocation.  |  |
| **requestId** | **kotlin.String** |  |  |



