
# GmailReviewResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **idempotentReplay** | **kotlin.Boolean** | &#x60;true&#x60; when this response replays a prior committed interpretation for the same organization, Idempotency-Key, and request payload. A replay is answered from canonical state and does not call the interpretation provider again.  |  |
| **interpretedAt** | **kotlin.String** | When the interpretation that produced these proposals committed. On a replay this is the original occurrence&#39;s time, not the time of the replayed request.  |  |
| **taskSuggestions** | [**kotlin.collections.List&lt;TaskSuggestion&gt;**](TaskSuggestion.md) | The 0..N canonical pending proposals this Gmail Review produced, using the same &#x60;TaskSuggestion&#x60; schema the Owner proposal reads return. An empty array is truthful success, not a failure.  |  |



