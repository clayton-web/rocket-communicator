
# NotificationProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **deliveryEnabled** | **kotlin.Boolean** | Whether &#x60;ENABLE_OWNER_EVENT_DELIVERY&#x60; was exactly \&quot;true\&quot;. False in every environment in this milestone. Independent of &#x60;ENABLE_OWNER_EVENT_CAPTURE&#x60;, which governs whether intents are recorded at all and is also unset everywhere (D135).  |  |
| **transportConfigured** | **kotlin.Boolean** | Whether a transport was available to deliver through. False means the invocation failed closed and did no work: processing refuses to run rather than manufacturing a transport that would report deliveries it never made.  **False in every environment in A8.5b**, including with delivery enabled. The only implementation in this milestone is a deterministic fake belonging to tests; no Owner notification email renderer and no Gmail adapter exist yet, so there is nothing this endpoint could compose. A8.5c adds the real adapter.  |  |
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
| **deadlineStopped** | **kotlin.Boolean** | Whether the invocation stopped accepting new work to stay inside its runtime budget. Work already claimed is settled before stopping, so nothing is abandoned mid-flight by a deliberate stop.  |  |
| **requestId** | **kotlin.String** | Correlates this invocation with its structured logs. |  |



