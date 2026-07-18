
# SuggestionProcessResponse

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **claimed** | **kotlin.Int** | Events successfully claim-leased in this invocation. |  |
| **skippedIrrelevant** | **kotlin.Int** | Events marked skipped_irrelevant by heuristic relevance (no suggestion). |  |
| **suggestionsCreated** | **kotlin.Int** | Pending TaskSuggestions created via LLM extraction. |  |
| **failedRetryable** | **kotlin.Int** | Events left or set to failed_retryable (no suggestion created). |  |
| **failedPermanent** | **kotlin.Int** | Events set to failed_permanent (no suggestion created). |  |
| **requestId** | **kotlin.String** |  |  |



