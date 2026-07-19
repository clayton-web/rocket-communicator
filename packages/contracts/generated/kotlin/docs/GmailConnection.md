
# GmailConnection

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **status** | [**GmailConnectionStatus**](GmailConnectionStatus.md) |  |  |
| **provider** | [**CommunicationProvider**](CommunicationProvider.md) |  |  |
| **historyState** | [**GmailHistoryState**](GmailHistoryState.md) |  |  |
| **pollingIntervalMinutes** | **kotlin.Int** | Configured poll interval (D065 default 5). |  |
| **inboxOnly** | **kotlin.Boolean** | Always true in A5 (D068). |  |
| **readonlyScope** | **kotlin.Boolean** | True when &#x60;gmail.readonly&#x60; is granted for ingest/polling (D070). Does **not** by itself imply send permission. Prefer &#x60;canRead&#x60; / &#x60;canSend&#x60; when present (D093).  |  |
| **emailAddress** | **kotlin.String** | Connected mailbox address when known. Never a token. |  [optional] |
| **connectedAt** | **kotlin.String** |  |  [optional] |
| **lastSyncAt** | **kotlin.String** |  |  [optional] |
| **lastSuccessAt** | **kotlin.String** |  |  [optional] |
| **lastErrorCode** | **kotlin.String** | Stable machine code only; never raw provider payloads. |  [optional] |
| **canRead** | **kotlin.Boolean** | Optional A7+ flag: true when the connection can poll/read Inbox History (&#x60;gmail.readonly&#x60;). When omitted, clients may treat connected + &#x60;readonlyScope&#x60; as readable for A5 compatibility.  |  [optional] |
| **canSend** | **kotlin.Boolean** | Optional A7+ flag: true when &#x60;gmail.send&#x60; is granted for assignment email and forward (D093). When omitted or false while connected, A7 handoff requires Owner re-consent (&#x60;requiresSendReconsent&#x60;). Runtime OAuth still requests readonly-only until A7 OAuth work ships — this field is contract-ready.  |  [optional] |
| **requiresSendReconsent** | **kotlin.Boolean** | Optional A7+ flag: true when handoff/send needs Owner OAuth re-consent to grant &#x60;gmail.send&#x60;. Safe boolean — does not expose raw Google scope strings.  |  [optional] |



