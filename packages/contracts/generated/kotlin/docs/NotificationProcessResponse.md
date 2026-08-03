
# NotificationProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **captureEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_OWNER_EVENT_CAPTURE&#x60; was exactly \&quot;true\&quot;, which is what governs the capability-expiry capture phase. False in every environment. Fully independent of &#x60;deliveryEnabled&#x60;: capture records durable events, delivery sends them, and neither implies the other (D135).  |  |
| **deliveryEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_OWNER_EVENT_DELIVERY&#x60; was exactly \&quot;true\&quot;. False in every environment. Independent of &#x60;captureEnabled&#x60; above.  |  |
| **transportConfigured** | **kotlin.Boolean** | Whether a transport was composed for this invocation. False means no delivery was attempted: processing refuses to run rather than manufacturing a transport that would report deliveries it never made.  False whenever &#x60;deliveryEnabled&#x60; is false, since nothing is composed for a phase that is not running. Also false when delivery is enabled but the capture phase exhausted the invocation&#39;s budget first — in that case &#x60;expiryDeadlineStopped&#x60; is true, and no Gmail configuration was read on the way to doing nothing. With delivery enabled and budget remaining, false means composition itself failed closed, for example an absent or invalid application base URL.  |  |
| **expiryScanned** | **kotlin.Int** | Expired capabilities this invocation attempted to transition, oldest expiry first, up to the capture phase&#39;s own bound. Not a count of every expired capability in existence, which would require an unbounded scan.  |  |
| **expiryObserved** | **kotlin.Int** | Transitions this invocation won. Each wrote one &#x60;capability.expired&#x60; audit event and one notification intent in the same transaction as the status change.  |  |
| **expiryLostRaces** | **kotlin.Int** | Capabilities another observer — a concurrent invocation, or a Recipient presenting the lapsed token — had already transitioned. The loser writes nothing at all. Expected under overlap, and not an error.  |  |
| **expiryBatchFilled** | **kotlin.Boolean** | Whether the expiry scan came back full, so more expired capabilities probably remain for the next invocation. Deliberately not a count of what is left.  |  |
| **expiryDeadlineStopped** | **kotlin.Boolean** | Whether the capture phase stopped starting transitions to stay inside the invocation&#39;s runtime budget. When true the delivery phase did not begin at all, and the expiries already observed remain committed — their intents are found by the next invocation.  |  |
| **scanned** | **kotlin.Int** | Claimable intents examined, including those terminalized without any delivery — a stale suppression and an exhausted retry budget are both counted here and also in their own field.  |  |
| **claimed** | **kotlin.Int** | Intents whose compare-and-set claim succeeded and whose lease this invocation held. |  |
| **sent** | **kotlin.Int** | Deliveries the transport positively accepted. An ambiguous outcome is never counted here (D135): the provider may have accepted it, and reporting a delivery that may not have happened is the untruth this separation exists to prevent.  |  |
| **failedRetryable** | **kotlin.Int** | Retryable transport failures with budget remaining. The intent returned to claimable work and will be attempted again on a later invocation, not within this one.  |  |
| **failedPermanent** | **kotlin.Int** | Definitive refusals. Terminal on the first occurrence and requiring Owner attention. |  |
| **ambiguous** | **kotlin.Int** | Outcomes the transport could not resolve, including a lease that expired after a provider call had begun and a transport that threw once the in-flight marker was durable. Terminal on the first occurrence, never retried, and never reported as sent (D135). Requires Owner attention.  |  |
| **staleSuppressed** | **kotlin.Int** | Intents older than the 24-hour delivery horizon, terminalized without contacting anything (D135). This is what stops a backlog accumulated while delivery was disabled from ever flushing: those intents expire rather than being drained.  |  |
| **retryExhausted** | **kotlin.Int** | Intents that spent their three-attempt budget, terminalized as requiring Owner attention. A budget against one event, not a delivery series: D106&#39;s fourteen-delivery ceiling and D129&#39;s ambiguity stop govern Recipient reminders and do not apply here.  |  |
| **recoveredClaims** | **kotlin.Int** | Lapsed leases returned to claimable work because no provider call had started. A lapsed lease whose provider call had started is counted in &#x60;ambiguous&#x60; instead and is never resent.  |  |
| **lostClaims** | **kotlin.Int** | Compare-and-set refusals: another worker moved first, or this one was superseded while its call was in flight. Expected under overlapping invocations, and not an error.  |  |
| **batchFilled** | **kotlin.Boolean** | Whether the scan returned a full batch, so more work probably remains. Deliberately not a count of what is left, which would require an unbounded count over every pending row.  |  |
| **deadlineStopped** | **kotlin.Boolean** | Whether the invocation stopped accepting new work to stay inside its runtime budget. Work already claimed is settled before stopping, so nothing is abandoned mid-flight by a deliberate stop. Invocation-level and therefore true if **either** phase stopped; &#x60;expiryDeadlineStopped&#x60; distinguishes which.  |  |
| **requestId** | **kotlin.String** | Correlates this invocation with its structured logs. |  |



